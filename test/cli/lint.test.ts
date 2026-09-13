import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { run } from '../../src/cli/index.ts'
import { MIN_ANTISOLUTIONS, MIN_SOLUTIONS } from '../../src/engine/validate/harness.ts'
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

async function lint(root: string, ...extra: string[]) {
  const c = capture()
  const code = await run(['lint', '--content', root, ...extra], c.io)
  return { code, out: c.out.join('\n'), err: c.err.join('\n') }
}

function countProblems(err: string, pattern: RegExp): number {
  return err.split('\n').filter((l) => l.startsWith('problem:') && pattern.test(l)).length
}

/**
 * What a content root *contains*, counted here by a walk this file owns.
 *
 * The two numbers `rhcsa lint` prints used to be asserted as the literals `5` and
 * `21`, which is how they were measured on the bank of the day. That is a trap
 * rather than a check: every task added to `content/` turns four green tests red
 * with a number, tells the next author nothing about what broke, and invites them
 * to bump the literal — which re-arms it. Worse, `/graders checked: 5/` is
 * unanchored, so it would also have matched `graders checked: 50`.
 *
 * So the expectation is derived, and deliberately derived from a **second walk**
 * rather than from `lintContent`'s own return value. Comparing the lint's count to
 * the lint's count is vacuous; comparing it to an independent count of the files on
 * disk is the property actually worth pinning — *the number it reports is the
 * number of graders there are*, whatever the bank grows to.
 *
 * `headerScripts` is `grade.sh` count plus `antisolutions/*.sh` count because those
 * are exactly the two `inventory.push` sites in `lintContent`: one per grader
 * (unconditionally, since `# baseline-fail:` is required of every grader) and one
 * per anti-solution fixture. Solutions and `setup.sh` carry no header and are not
 * inventoried. If that ever changes, this identity fails loudly here — which is the
 * point — rather than a stale literal failing for the wrong reason.
 */
async function walkInventory(root: string): Promise<{ graders: number; headerScripts: number }> {
  const entries = await readdir(join(root, 'tasks'), { recursive: true, withFileTypes: true })
  let graders = 0
  let antisolutions = 0
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.sh')) continue
    if (e.name === 'grade.sh') graders += 1
    else if (basename(e.parentPath) === 'antisolutions') antisolutions += 1
  }
  // Anti-vacuity, the same rule the golden fixture test states: a walk that found
  // nothing must not be able to agree with a lint that checked nothing.
  expect(graders, `no grade.sh under ${root}/tasks, so nothing below proves anything`).toBeGreaterThan(0)
  expect(antisolutions).toBeGreaterThan(0)
  return { graders, headerScripts: graders + antisolutions }
}

/** Both counts the lint prints, anchored to whole lines so `5` cannot match `50`. */
async function expectInventoryReported(out: string, root: string): Promise<void> {
  const live = await walkInventory(root)
  expect(out, `expected "graders checked: ${live.graders}"`).toMatch(
    new RegExp(`^graders checked: ${live.graders}$`, 'm'),
  )
  expect(out, `expected "scripts with headers: ${live.headerScripts}"`).toMatch(
    new RegExp(`^scripts with headers: ${live.headerScripts}$`, 'm'),
  )
}

describe('rhcsa lint on the shipped bank', () => {
  it('exits 0 and needs no VM, no .env.local and no network', async () => {
    // Every other content gate in this project goes through `rhcsa validate`,
    // which reverts a snapshot and reboots a guest. On a checkout with no ISO —
    // which is any fresh checkout — this is the only content gate that exists.
    const r = await lint(CONTENT)
    expect(r.err).toBe('')
    expect(r.code).toBe(0)
    // Derived from a walk of `content/`, not a literal: see `walkInventory`.
    await expectInventoryReported(r.out, CONTENT)
  })

  it('prints the inventory it checked, not just a verdict', async () => {
    const r = await lint(CONTENT)
    expect(r.out).toMatch(/baseline-fail: fs-home-size@both, lv-home-size@both/)
    expect(r.out).toMatch(/unprobed-invariant: var-intact/)
    expect(r.out).toMatch(/emits: fs-home-size, home-from-lv, lv-home-size, persist-config, var-intact/)
  })

  it('prints the @phase of every declared checkpoint, not just its id', async () => {
    // The phase is verdict A versus verdict B — "it works now" versus "it
    // survives a reboot" — which is the single distinction this project exists to
    // teach, and the one the RHCSA exam punishes people for missing. It has to be
    // visible in the output a reviewer reads and in the fixture the drift check
    // compares, not parsed and then dropped on the floor.
    const r = await lint(CONTENT)
    expect(r.out).toMatch(/expect-fail: fs-home-size@post, home-from-lv@post, persist-config@both/)
    // The default phase is written out rather than omitted, so losing a @post
    // reads as @post -> @both in a diff instead of as a suffix vanishing. If any
    // declared entry ever prints bare, this catches it.
    for (const line of r.out.split('\n')) {
      const m = /^ {2}(baseline-fail|expect-fail): (.*)$/.exec(line)
      if (m === null) continue
      for (const entry of (m[2] ?? '').split(', ')) {
        expect(entry, `${line} has a declared entry with no @phase`).toMatch(/@(pre|post|both)$/)
      }
    }
  })

  it('reports an anti-solution-anchored undeclared id as a note, never as a failure', async () => {
    // Getting this backwards would fail every task in the bank: a grader
    // legitimately emits invariants that pass at baseline and are therefore
    // absent from `# baseline-fail:` by design. What makes leaving it as a note
    // safe is the anchor — a sibling anti-solution's `# expect-fail:` names it, so
    // a rename breaks that check loudly. An id with no anchor is now an error; see
    // `catches a checkpoint id no header anywhere in the task names`.
    const r = await lint(CONTENT)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/note: .*home-from-lv is emitted but named by no header on this grader/)
    expect(r.err).not.toMatch(/home-from-lv/)
    // The whole shipped bank sits in the note category and none of it in the error
    // one, which is what "no content edits" means here.
    expect(r.out).not.toMatch(/named by no header anywhere in this task/)
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

  it('catches an anti-solution whose body is only comments, so it detects nothing', async () => {
    // An anti-solution exists to prove the grader detects a specific wrong answer, and
    // nothing in `runFixture` establishes that applying it changed the machine. At the
    // unsolved baseline the goal checkpoints already fail — exactly what the header
    // declares — so a fixture that does nothing is certified as a working detector. It
    // is green because the task is unsolved, not because the grader caught anything.
    //
    // This is the natural half-written shape, not an exotic one: `# expect-fail:` is
    // itself a comment, so the authoring order every fixture in this bank follows —
    // paragraph, header, `set -euo pipefail`, then the command — satisfies the header
    // rule one line before the fixture does anything.
    const root = await bankCopy()
    const fixture = 'tasks/storage/014-grow-home-lv/antisolutions/01-forgot-growfs.sh'
    await writeFile(
      join(root, fixture),
      [
        '#!/usr/bin/env bash',
        '# The paragraph and the header landed; the lvextend never did.',
        '# expect-fail: fs-home-size',
        'set -euo pipefail',
        '',
      ].join('\n'),
      'utf8',
    )

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/01-forgot-growfs\.sh: nothing here but comments and shell options/)
    // The kill has to be attributable to *this* rule. Crediting one to an earlier
    // assertion is a named defect class on this task, so the fixture is built to trip
    // nothing else: the header is present and names an id the sibling grader really
    // emits, so neither the missing-header throw nor `checkDeclaredAreEmitted` fires,
    // and this file contributes exactly one problem.
    expect(r.err).not.toMatch(/must declare a "# expect-fail:" header/)
    expect(r.err).not.toMatch(/expect-fail names/)
    expect(countProblems(r.err, /01-forgot-growfs\.sh/)).toBe(1)
    // And the header was genuinely read rather than skipped past.
    expect(r.out).toMatch(/^ {2}expect-fail: fs-home-size@both$/m)
  })

  it('does not flag a set-options line joined to a real command by a semicolon', async () => {
    // SHELL_OPTION_LINE used to be start-anchored only, so `.test()` matched on
    // the `set -` prefix alone and `changesNothing` discarded the whole line —
    // including a real command joined on with `;` — as a no-op. That reported an
    // anti-solution that does real work as one that changes nothing, with this
    // rule named in the message: the loud direction, telling its author the
    // opposite of the truth.
    const root = await bankCopy()
    const fixture = 'tasks/storage/014-grow-home-lv/antisolutions/01-forgot-growfs.sh'
    await writeFile(
      join(root, fixture),
      [
        '#!/usr/bin/env bash',
        '# expect-fail: fs-home-size',
        'set -euo pipefail; sudo lvextend -L 12G /dev/rhel/home',
        '',
      ].join('\n'),
      'utf8',
    )

    const r = await lint(root)
    expect(r.err).not.toMatch(/nothing here but comments and shell options/)
    expect(r.code).toBe(0)
  })

  it('does not flag a set-options line joined to a real command by &&', async () => {
    // SHELL_OPTION_LINE's fix for the `;` case above excluded only `;`, leaving
    // `&&` and `||` open. `&&` is the more idiomatic joiner of the two under
    // `set -e`, so this is the likelier authoring shape, not an edge case: a
    // fixture that does real work past `&&` was still discarded as a no-op, with
    // this rule named in the message telling its author the opposite of the truth.
    const root = await bankCopy()
    const fixture = 'tasks/storage/014-grow-home-lv/antisolutions/01-forgot-growfs.sh'
    await writeFile(
      join(root, fixture),
      [
        '#!/usr/bin/env bash',
        '# expect-fail: fs-home-size',
        'set -euo pipefail && sudo lvextend -L 12G /dev/rhel/home',
        '',
      ].join('\n'),
      'utf8',
    )

    const r = await lint(root)
    expect(r.err).not.toMatch(/nothing here but comments and shell options/)
    expect(r.code).toBe(0)
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
    // Four, not two: each planted id breaks two independent rules at once — the
    // kebab grammar and, since `resolveUndeclared`, "no header anywhere in this
    // task names this". Both are real and both name the id, so collapsing them
    // would mean one rule silently covering for the other.
    expect(r.err).toMatch(/^4 problem\(s\)$/m)
    expect(countProblems(r.err, /is not lowercase kebab-case/)).toBe(2)
    expect(countProblems(r.err, /named by no header anywhere in this task/)).toBe(2)
  })

  it('catches a checkpoint id no header anywhere in the task names', async () => {
    // The finding. A grader that emits an id nothing declares used to produce one
    // more informational note and exit 0 — so renaming a checkpoint, or typing its
    // id wrong, was swallowed with no signal at all. The id here is valid kebab and
    // is not a variable, so no other rule can claim the kill: the only thing wrong
    // with it is that nothing in the task says it should exist.
    const root = await bankCopy()
    await plant(root, (t) => `${t}true; ck orphaned-checkpoint "nothing declares this" $?\n`)

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/orphaned-checkpoint is emitted but named by no header anywhere in this task/)
    // Actionable in both of the two ways an author can act.
    expect(r.err).toMatch(/Declare it, or fix the id/)
    expect(countProblems(r.err, /orphaned-checkpoint/)).toBe(1)
    // And it is no longer filed as a note, which is what made it invisible.
    expect(r.out).not.toMatch(/note: .*orphaned-checkpoint/)
  })

  it('catches a renamed checkpoint id, which used to be two notes and exit 0', async () => {
    // The realistic shape: a rename that lands in the grader and nowhere else.
    // `home-from-lv` is named only by an anti-solution's `# expect-fail:`, so
    // before this it was a note either way — the note set and the typo set were the
    // same set, and the lint could not tell them apart.
    const root = await bankCopy()
    await plant(root, (t) => t.replaceAll('home-from-lv ', 'home-from-lvm '))

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/home-from-lvm is emitted but named by no header anywhere in this task/)
    // And the far end of the rename is loud too, which is the property that makes
    // an anti-solution-named id safe to leave as a note.
    expect(r.err).toMatch(/expect-fail names home-from-lv, which the grader never emits/)
  })

  it('leaves an id an anti-solution names as a note, so the bank does not need editing', async () => {
    // The control, and the ruling. An invariant that passes at the unsolved
    // baseline cannot appear in `# baseline-fail:`, so undeclared-on-the-grader is
    // a legitimate shape; an anti-solution naming the id is a second reference that
    // anchors it, and breaking that reference is an error (the test above). Without
    // this arm, making every undeclared id an error would satisfy the two tests
    // above while failing three graders that are correct.
    const root = await bankCopy()
    const r = await lint(root)
    expect(r.code).toBe(0)
    expect(r.err).toBe('')
    expect(r.out).toMatch(/note: .*home-from-lv is emitted but named by no header on this grader/)
    expect(r.out).toMatch(/a sibling anti-solution's "# expect-fail:" names it/)
  })
})

describe('rhcsa lint fails when there is nothing to check', () => {
  // "Nothing to check" must not be indistinguishable from "all clear". Every
  // check in `lintContent` is a loop over the graders it found, so an empty
  // grader list runs zero checks, collects zero problems and would exit 0 — a
  // gate reporting success it did not earn, which is the same shape as the
  // fail-open defects this lint was written to catch.
  //
  // This is not a hypothetical: a moved `content/`, a typo'd `--content` path
  // that happens to name a real directory, or a half-finished checkout all
  // produce it, and the thing that gates — a CI step, a pre-commit hook, an npm
  // script in a wrapper — reads the exit code, not the stdout that helpfully
  // says `graders checked: 0`.

  async function emptyRoot(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'rhcsa-lint-empty-'))
    temps.push(dir)
    // A real directory holding real shell scripts, none of which is a grader —
    // strictly harder than an empty directory, and closer to a bank whose task
    // directories were moved out from under it.
    await mkdir(join(dir, 'tasks', 'storage', '014-grow-home-lv'), { recursive: true })
    await writeFile(join(dir, 'tasks', 'storage', '014-grow-home-lv', 'setup.sh'), '#!/bin/bash\ntrue\n', 'utf8')
    return dir
  }

  it('exits non-zero with a named problem on a content root holding no grade.sh', async () => {
    const r = await lint(await emptyRoot())
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/no grade\.sh found, so nothing was checked/)
    // The message has to say what to do, because the operator seeing it is
    // most likely looking at a path problem, not a content problem.
    expect(r.err).toMatch(/--allow-empty/)
    // Anchored to the whole line: unanchored, `0` also matches `graders checked: 011`
    // and, more to the point, `5` used to match `50`.
    expect(r.out).toMatch(/^graders checked: 0$/m)
  })

  it('exits 0 there when --allow-empty says the empty bank is expected', async () => {
    const c = capture()
    const code = await run(['lint', '--content', await emptyRoot(), '--allow-empty'], c.io)
    expect(c.err.join('\n')).toBe('')
    expect(code).toBe(0)
    expect(c.out.join('\n')).toMatch(/no problems in 0 grader\(s\)/)
  })

  it('still exits non-zero for a root that does not exist at all', async () => {
    // The ENOENT path and the empty path are different code paths with the same
    // required outcome; a fix to one must not quietly regress the other.
    const c = capture()
    expect(await run(['lint', '--content', join(tmpdir(), 'rhcsa-no-such-root-2')], c.io)).toBe(1)
  })

  it('does not let --allow-empty suppress a real problem in a non-empty bank', async () => {
    // The flag says "zero graders is acceptable here", not "be quiet". Widening
    // it into a general mute is the obvious wrong turn for the next person
    // editing this, so it is pinned.
    const root = await bankCopy()
    await plant(root, (t) => `${t}true; ck LV_Size "bad name" $?\n`)

    const c = capture()
    const code = await run(['lint', '--content', root, '--allow-empty'], c.io)
    expect(code).toBe(1)
    expect(c.err.join('\n')).toMatch(/LV_Size/)
  })
})

describe('rhcsa lint enforces the fixture floors it derives from the bank', () => {
  // The floors themselves are not new: `inventoryGate` in
  // src/engine/validate/harness.ts has held them since Task 18. What is new is
  // where they run. That gate is inside `rhcsa validate`, which reverts a snapshot
  // and needs a guest, and has never run against one in this project's history;
  // this command is the content gate that needs no VM. So a thin or vanished
  // fixture set was a content defect the project had already named and had no
  // executing check for.
  //
  // Every plant below is the same shape as F1's: the walk found fewer files, so
  // there was less to compare, so everything compared successfully. The fix is
  // that the expectation now comes from `bank.tasks` — the only thing that knows a
  // task is supposed to have fixtures at all — and not from the walk.

  const STORAGE = 'tasks/storage/014-grow-home-lv' // 2 solutions, 3 anti-solutions
  const USERS = 'tasks/users/006-team-provisioning' // 3 solutions, 2 anti-solutions

  it('passes the shipped bank, so these rules are a floor under today\'s content', async () => {
    // Stated as its own test rather than left implicit in the exit-0 test above:
    // a floor that fires on committed content is a change to the content, and
    // this is not one. Every task clears both floors and no non-.sh file sits
    // anywhere under a fixture directory. (The bank was five tasks with
    // anti-solution counts 5/3/3/3/2 when this was written; it is deliberately not
    // restated as a number here, because the assertion is "no problems", not "this
    // many files".)
    const r = await lint(CONTENT)
    expect(r.err).toBe('')
    expect(r.code).toBe(0)
  })

  it('catches a missing antisolutions/ directory, which a walk cannot notice', async () => {
    // The original third silent-green channel, measured at exit 0 before this
    // rule existed: three inventory rows fewer than the bank of the day had (18 of
    // 21), every header that remained agreeing with itself, no problems.
    const root = await bankCopy()
    await rm(join(root, STORAGE, 'antisolutions'), { recursive: true })

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/014-grow-home-lv: antisolutions\/ is missing/)
  })

  it('catches antisolutions/ misspelled as antisolutons/, which is the documented failure mode', async () => {
    // docs/r1-findings.md diagnoses this one as "the directory name is
    // misspelled; readdir failures are swallowed", and prescribes a human
    // checking the spelling by hand. The files are all still there and all still
    // valid; nothing loads them.
    const root = await bankCopy()
    await rename(join(root, STORAGE, 'antisolutions'), join(root, STORAGE, 'antisolutons'))

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/014-grow-home-lv: antisolutions\/ is missing/)
  })

  it('catches an anti-solution count below MIN_ANTISOLUTIONS, with the directory still present', async () => {
    // Distinct from the case above: the directory exists and is readable, so the
    // swallow is not involved. This is the floor doing the work.
    const root = await bankCopy()
    const dir = join(root, USERS, 'antisolutions')
    await rm(join(dir, '01-no-group-no-sudo.sh'))
    await rm(join(dir, '02-aging-skipped.sh'))

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(
      new RegExp(`006-team-provisioning: needs at least ${MIN_ANTISOLUTIONS} anti-solution, found 0`),
    )
    // The wording is harness.ts's, and the numbers are imported from it rather
    // than restated. Two copies of a floor drift, and the copy nobody runs drifts
    // first.
    expect(MIN_ANTISOLUTIONS).toBe(1)
  })

  it('catches a solution count below MIN_SOLUTIONS', async () => {
    // Anti-solutions catch a grader that passes work that should fail; multiple
    // independent solutions catch a grader over-fitted to one author's habits.
    // Both floors exist for stated reasons and both now run without a guest.
    const root = await bankCopy()
    await rm(join(root, STORAGE, 'solutions', '02-lvextend-r-by-uuid.sh'))

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(new RegExp(`014-grow-home-lv: needs at least ${MIN_SOLUTIONS} solutions, found 1`))
    expect(MIN_SOLUTIONS).toBe(2)
  })

  it('catches a fixture renamed off .sh, which no count notices', async () => {
    // The nastiest of the four, because it survives the floor. 014 has three
    // anti-solutions; renaming one leaves two, which clears MIN_ANTISOLUTIONS, so
    // the fixture is silently gone from every run and no count is out of range.
    // The assertion below therefore also proves the floor did *not* fire — if it
    // had, this test would pass whether the unexpected-file rule existed or not.
    const root = await bankCopy()
    const dir = join(root, STORAGE, 'antisolutions')
    await rename(join(dir, '03-wrong-lv.sh'), join(dir, '03-wrong-lv.sh.bak'))

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/antisolutions\/03-wrong-lv\.sh\.bak does not end in \.sh/)
    expect(r.err).not.toMatch(/needs at least/)
  })

  it('catches a solution renamed off .sh even where the floor still clears', async () => {
    // The same rule on the sibling directory, which the brief's four did not
    // name. Measured: 006 ships three solutions, so renaming one leaves exactly
    // MIN_SOLUTIONS and the floor stays quiet — the asymmetry was a live hole rather
    // than a tidiness point. Most tasks ship exactly two solutions, where the floor
    // would have caught it; 006 is picked here precisely because it has the spare
    // one, and that is the case the floor cannot see.
    const root = await bankCopy()
    const dir = join(root, USERS, 'solutions')
    await rename(join(dir, '03-primary-group-only.sh'), join(dir, '03-primary-group-only.sh.disabled'))

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/solutions\/03-primary-group-only\.sh\.disabled does not end in \.sh/)
    expect(r.err).not.toMatch(/needs at least/)
  })

  it('reports a missing grade.sh from the bank, not only from its orphaned anti-solutions', async () => {
    // The interlock this replaces ran one direction only. A deleted grade.sh was
    // caught because its anti-solutions became orphans and said `no sibling
    // grade.sh`; delete the anti-solutions too and there was no orphan left to
    // complain. Both halves gone, and both halves silent. The `not.toMatch`
    // is the load-bearing half of this test: it proves the problem below came
    // from the bank and not from the old interlock.
    const root = await bankCopy()
    await rm(join(root, STORAGE, 'grade.sh'))
    await rm(join(root, STORAGE, 'antisolutions'), { recursive: true })

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/014-grow-home-lv is in the bank but has no grade\.sh/)
    expect(r.err).not.toMatch(/no sibling grade\.sh/)
  })

  it('reports a task with no setup.sh, which nothing else validates', async () => {
    // No task loader requires `setup.sh`, so the bank loads happily without it.
    // `loadTaskScripts` reads it with a bare `readFile` and no `.catch`, unlike the
    // `readdir(dir).catch(() => [])` eleven lines below it — so the failure is late
    // rather than swallowed: the lab cannot start and validate cannot run. Checked
    // here because this command is the only gate a checkout with no ISO can run,
    // and docs/exit-criterion.md sends the reader here before a VM exists.
    const root = await bankCopy()
    await rm(join(root, STORAGE, 'setup.sh'))

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/014-grow-home-lv has no setup\.sh/)
  })

  it('reports a setup.sh that is a directory rather than a file', async () => {
    // `stat().isFile()` rather than `access()`, because a directory at that path is
    // not a script `readFile` can load and `access` would report it as present.
    const root = await bankCopy()
    await rm(join(root, STORAGE, 'setup.sh'))
    await mkdir(join(root, STORAGE, 'setup.sh'))

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/014-grow-home-lv has no setup\.sh/)
  })

  it('reports a fixture directory it cannot read, as distinct from one that is absent', async () => {
    // The `unreadable` arm, reached without a permissions fixture and without sudo:
    // a regular *file* named `antisolutions` makes readdir fail ENOTDIR, not ENOENT.
    // It fails closed either way, so this is not a false-green guard — it is the one
    // arm of scanFixtureDir that had no test, in the function this task hardened.
    const root = await bankCopy()
    await rm(join(root, STORAGE, 'antisolutions'), { recursive: true })
    await writeFile(join(root, STORAGE, 'antisolutions'), 'not a directory\n', 'utf8')

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/antisolutions\/ could not be read \(.*ENOTDIR/)
    // Distinct from the absent message, so the operator is not sent looking for a
    // misspelling when the problem is the entry's type.
    expect(r.err).not.toMatch(/antisolutions\/ is missing/)
  })

  it('reports a grader no bank task owns, so neither half rests on the other', async () => {
    // `bank.tasks` is itself assembled from a walk for task.yaml, so iterating it
    // closes the missing-expectation hole one way only. Remove a task.yaml and
    // the task leaves the list that drives every rule above, while its grade.sh
    // still gets its headers checked and its fixtures get counted by nobody.
    const root = await bankCopy()
    await rm(join(root, STORAGE, 'task.yaml'))

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/no task in the bank owns this grader/)
    // Every grader in the copy is still on disk and still checked — removing a
    // task.yaml costs the bank a task, not the walk a script. Counted against
    // `root`, the copy actually linted, so the assertion holds whatever the plant
    // above did to the tree.
    await expectInventoryReported(r.out, root)
  })

  it('says so loudly when the bank will not load, and still lints the headers', async () => {
    // "The floors could not be checked" is a problem, not a note and not
    // silence — the same rule as F1 one level up. The header checks keep running
    // regardless, which is the split documented on `taskDirOf`: a YAML error must
    // not take the script lint down with it.
    const root = await bankCopy()
    await writeFile(join(root, 'objectives.yaml'), 'this: [is not\n  valid: yaml\n', 'utf8')

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/the bank did not load, so the per-task fixture floors were not checked/)
    // The whole script half still ran: both counts are the copy's full inventory,
    // not a truncated one, which is the "a YAML error must not take the script lint
    // down with it" claim stated as a number.
    await expectInventoryReported(r.out, root)
  })
})

describe('rhcsa lint runs the bank-derived rules whatever the walk found', () => {
  // The rules in the block above are derived from `bank.tasks`. The grader count is
  // a *walk result*, and for one commit the floors sat behind `if (graders.length >
  // 0)` — so a bank still declaring five tasks with every grade.sh deleted found
  // zero graders and never reached the rule that exists to report exactly that.
  // With `--allow-empty`, which is the flag that makes zero graders a non-error, the
  // command exited 0 on that bank.
  //
  // That is this task's recurring defect in a new position. The other four were the
  // gate not looking at the thing; this one was the gate not running, behind a
  // precondition computed from one of the things it validates. So the count is
  // checked *by* the rules and is not allowed to gate them, and these tests pin the
  // placement rather than the logic — the logic was never wrong.

  /**
   * Every task still declared in the bank; every grade.sh and every antisolutions/
   * gone.
   *
   * Returns the number of tasks stripped, because the rules under test fire **once
   * per bank task** and the count each one has to equal is therefore a property of
   * the bank rather than a number anybody should be typing. It used to be the
   * literal `5`, which meant adding a task to `content/` turned these four tests red
   * with an arithmetic complaint about a plant that had worked perfectly.
   *
   * `graders` is the right derivation for both rules: each task directory in the
   * shipped bank owns exactly one `grade.sh` and exactly one `antisolutions/`, and
   * that is not assumed here — `antisolutionDirs` is counted separately and required
   * to agree, and the shipped-bank test at the top of this file (0 problems, so no
   * `has no grade.sh` and no `antisolutions/ is missing`) is what keeps the
   * task-to-grader mapping one-to-one.
   */
  async function strippedBank(): Promise<{ root: string; tasks: number }> {
    const root = await bankCopy()
    const entries = await readdir(join(root, 'tasks'), { recursive: true, withFileTypes: true })

    let graders = 0
    for (const e of entries) {
      if (e.isFile() && e.name === 'grade.sh') {
        await rm(join(e.parentPath, e.name))
        graders += 1
      }
    }
    let antisolutionDirs = 0
    for (const e of entries) {
      if (e.isDirectory() && e.name === 'antisolutions') {
        await rm(join(e.parentPath, e.name), { recursive: true })
        antisolutionDirs += 1
      }
    }
    // The plant has to have landed on every task, or the counts below prove nothing:
    // a stripped bank that stripped nothing would report zero problems and read as
    // agreement.
    expect(graders, 'no grade.sh was stripped, so the tests below prove nothing').toBeGreaterThan(0)
    expect(antisolutionDirs, 'one grade.sh per antisolutions/ is what the counts below assume').toBe(graders)
    return { root, tasks: graders }
  }

  it('fires the grade.sh rule once per bank task at zero graders, under --allow-empty', async () => {
    const { root, tasks } = await strippedBank()
    const r = await lint(root, '--allow-empty')

    expect(r.code).toBe(1)
    // One problem per task the bank still declares — every task, not "some": the
    // rule is unreachable-if-guarded, so a partial count is the defect coming back.
    expect(countProblems(r.err, /is in the bank but has no grade\.sh/)).toBe(tasks)
    expect(countProblems(r.err, /antisolutions\/ is missing/)).toBe(tasks)
    // The walk really did find nothing, which is what made this reachable: the
    // rules fired from `bank.tasks` alone.
    expect(r.out).toMatch(/^graders checked: 0$/m)
  })

  it('fires them at zero graders without the flag too, so the flag is not the axis', async () => {
    // Both axes, because `--allow-empty` was only the thing that made the exit code
    // 0. The unreachability was there without it, and a fix that worked only under
    // the flag would leave the placement bug intact.
    const { root, tasks } = await strippedBank()
    const r = await lint(root)

    expect(r.code).toBe(1)
    expect(countProblems(r.err, /is in the bank but has no grade\.sh/)).toBe(tasks)
    expect(r.err).toMatch(/no grade\.sh found, so nothing was checked/)
  })

  it('fires the setup.sh rule at zero graders as well, with and without the flag', async () => {
    // setup.sh inherits the placement fix, and both axes are pinned because the flag
    // is now a live axis for every bank-derived rule rather than for the one guard
    // it was written against.
    const { root } = await strippedBank()
    await rm(join(root, 'tasks/storage/014-grow-home-lv/setup.sh'))

    for (const args of [[], ['--allow-empty']]) {
      const r = await lint(root, ...args)
      expect(r.code, `args: ${JSON.stringify(args)}`).toBe(1)
      expect(r.err).toMatch(/014-grow-home-lv has no setup\.sh/)
    }
  })

  it('still exits 0 under --allow-empty on a root with no bank at all', async () => {
    // What the flag was added for, and it has to keep working: deliberately linting
    // a root before any task is authored. There is no bank to load and no task to
    // iterate, so no rule has anything to say — which is a different fact from the
    // case above, where every task in the bank was still declared.
    const dir = await mkdtemp(join(tmpdir(), 'rhcsa-lint-nobank-'))
    temps.push(dir)
    await mkdir(join(dir, 'tasks'), { recursive: true })

    const r = await lint(dir, '--allow-empty')
    expect(r.err).toBe('')
    expect(r.code).toBe(0)
  })

  it('reports a bank that will not load at zero graders, which is the flag\'s own use case', async () => {
    // `--allow-empty` documents itself for the half-authored root, and this is what
    // that actually looks like: `task.yaml` written first, with a YAML error in it,
    // before `grade.sh` and `antisolutions/` exist. The flag asserts **zero graders**,
    // not an unauthored root, so it must not swallow the loader's failure — and it did.
    // Measured before this fix, on a root still declaring all five tasks: exit 0, 0
    // problems, stderr 0 bytes. One ordinary YAML typo re-opened the exact channel the
    // unconditional floors above were written to close.
    const { root } = await strippedBank()
    await writeFile(
      join(root, 'tasks/storage/014-grow-home-lv/task.yaml'),
      'id: [broken\n  title: nope\n',
      'utf8',
    )

    const r = await lint(root, '--allow-empty')
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/the bank did not load, so the per-task fixture floors were not checked/)
    // The parse error itself, not merely "it failed": the operator needs the file and
    // the position, and a message that only says the bank is bad is not actionable.
    expect(r.err).toMatch(/task\.yaml: missed comma between flow collection entries/)
    // The walk really did find nothing, so the message came from the named-path check
    // and not from a grader being present.
    expect(r.out).toMatch(/^graders checked: 0$/m)
  })

  it('does not let --allow-empty excuse a bank that will not load when graders exist', async () => {
    // The grader-present half of the message rule. This comment used to claim "at zero
    // graders an unloadable bank is the flag's assertion being true" — false, and the
    // test above is the other half: at zero graders it is reported too, whenever
    // `objectives.yaml` is there to say somebody authored a bank. What is pinned here
    // is that a grader present makes the bank real regardless, so no flag suppresses
    // its failure to load. Widening the flag into a general mute is the obvious wrong
    // turn.
    const root = await bankCopy()
    await writeFile(join(root, 'objectives.yaml'), 'this: [is not\n  valid: yaml\n', 'utf8')

    const r = await lint(root, '--allow-empty')
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/the bank did not load, so the per-task fixture floors were not checked/)
  })
})

describe('rhcsa lint catches a script that reads its own remaining text from stdin', () => {
  const ANTI = 'tasks/net/046-key-based-ssh-login/antisolutions/04-moved-from-root-home-then-setenforce.sh'

  /** Plant an arbitrary fixture body, so a shape can be tested without a real defect nearby. */
  async function fixture(body: string): Promise<string> {
    const root = await bankCopy()
    const file = join(root, ANTI)
    const before = await readFile(file, 'utf8')
    // Keep the `# expect-fail:` header and the shebang; replace only the commands, so
    // the other rules in this file stay satisfied and the exit code is about this one.
    const head = before.slice(0, before.indexOf('set -euo pipefail'))
    await writeFile(file, `${head}set -euo pipefail\n${body}\n`, 'utf8')
    return root
  }

  it('catches the ausearch defect that cost a real validation run', async () => {
    // Not a synthetic shape: this is the line as it shipped on 2026-09-14, in the file
    // it shipped in. `sudo ausearch -m avc -ts recent` consumed the ten lines below it
    // — including the `sudo setenforce 0` the fixture existed to perform — and bash
    // exited 0 at end-of-input, so the harness saw a fixture that succeeded and the
    // grader was blamed for reporting SELinux correctly still Enforcing.
    const root = await bankCopy()
    const file = join(root, ANTI)
    const before = await readFile(file, 'utf8')
    const after = before.replace('ausearch -m avc -ts recent < /dev/null', 'ausearch -m avc -ts recent')
    expect(after, 'the plant did not change the fixture, so this test proves nothing').not.toBe(before)
    await writeFile(file, after, 'utf8')

    const { code, err } = await lint(root)
    expect(code).toBe(1)
    expect(countProblems(err, /ausearch/)).toBe(1)
    expect(err).toContain('Bash then exits 0 at end-of-input')
  })

  it('accepts every real form of the guard, and a pipe, so the rule is not just noisy', async () => {
    const root = await fixture(
      [
        'sudo ausearch -m avc -ts recent < /dev/null | tail -n 20 || true',
        'sudo ausearch -m avc < /tmp/saved-events | tail -n 1',
        'journalctl -k | sudo ausearch -m avc || true',
        'timeout 25 ssh -n deploy@localhost true',
        'timeout 25 ssh deploy@localhost true < /dev/null',
        'sudo ausearch -m avc <<EOF\ntype=AVC msg=audit(0.0:0): denied\nEOF',
      ].join('\n'),
    )
    const { code, err } = await lint(root)
    expect(countProblems(err, /ausearch|ssh/)).toBe(0)
    expect(code).toBe(0)
  })

  it('accepts a guard on a continuation line, which a line-at-a-time scan misses', async () => {
    // The lesson that put this rule in a committed file. A throwaway sweep over the
    // bank reported 160 candidates and every one was a false positive; two of them were
    // correctly guarded invocations whose `< /dev/null` sat on the *next* physical line,
    // exactly as `net/046`'s own `login_probe` and `tools/047`'s are written.
    const root = await fixture(
      ['timeout 25 ssh -o BatchMode=yes \\', '  deploy@localhost \\', '  true 2>&1 < /dev/null'].join('\n'),
    )
    const { code, err } = await lint(root)
    expect(countProblems(err, /ssh/)).toBe(0)
    expect(code).toBe(0)
  })

  it('does not read a command name out of an English message, however shell-shaped', async () => {
    // Both spellings that made this rule report five false hits on a clean bank before
    // `maskQuoted` existed: `(` reads as a subshell and `while` is a keyword, so each
    // satisfied a different clause of COMMAND_POSITION from inside a sentence. The
    // semicolon inside the quoted remote command is the third of the five — it split the
    // trailing redirect into another segment.
    const root = await fixture(
      [
        'rc=0',
        'echo "a password login failed (ssh exited $rc), and ausearch showed nothing"',
        'echo "firewall-ssh would pass while ssh stayed blocked"',
        `timeout 30 ssh deploy@localhost 'set -e; : > "$HOME/probe"; rm -f "$HOME/probe"' 2>&1 < /dev/null`,
      ].join('\n'),
    )
    const { code, err } = await lint(root)
    expect(countProblems(err, /ausearch|ssh/)).toBe(0)
    expect(code).toBe(0)
  })

  it('ignores a command that is only named, never run', async () => {
    const root = await fixture(['command -v ausearch >/dev/null || echo missing', '# sudo ausearch -m avc'].join('\n'))
    const { code, err } = await lint(root)
    expect(countProblems(err, /ausearch/)).toBe(0)
    expect(code).toBe(0)
  })

  it('reads inside a command substitution, which inherits stdin like any child', async () => {
    // `"$(…)"` is masked as a string by nothing: the substitution runs, and it runs with
    // the script on its stdin. This is the one place where quoting does not make a
    // command name inert.
    const root = await fixture('avc="$(sudo ausearch -m avc -ts recent)"\necho "${avc:-none}"')
    const { code, err } = await lint(root)
    expect(countProblems(err, /ausearch/)).toBe(1)
    expect(code).toBe(1)
  })

  it('checks setup.sh and solutions too, not only anti-solutions', async () => {
    // Same transport, same `bash -s`, same truncation. A rule that only read
    // anti-solutions would have missed the two setup scripts that probe a login.
    const root = await bankCopy()
    const file = join(root, 'tasks/net/046-key-based-ssh-login/solutions/01-keygen-install-restorecon.sh')
    const before = await readFile(file, 'utf8')
    await writeFile(file, `${before}\nsudo aureport -a\n`, 'utf8')

    const { code, err } = await lint(root)
    expect(countProblems(err, /aureport/)).toBe(1)
    expect(err).toContain('solutions/01-keygen-install-restorecon.sh')
    expect(code).toBe(1)
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
