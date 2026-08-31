import type { Dirent } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { loadBank, type Bank } from '../engine/content/bank.ts'
import { ContentError } from '../engine/content/errors.ts'
import { parseDeclaredIds, parseUnprobed } from '../engine/validate/expectations.ts'
import { MIN_ANTISOLUTIONS, MIN_SOLUTIONS } from '../engine/validate/harness.ts'
import { checkpointIds } from '../server/session.ts'

/**
 * Static checks over grader text, with no VM and no `.env.local`.
 *
 * Why this exists at all. `checkEmittedIds` in `src/engine/validate/harness.ts`
 * already compares declared ids against emitted ids — but only from inside
 * `rhcsa validate`, which reverts a snapshot and reboots a guest. On a fresh
 * checkout, or on any machine without a RHEL ISO, that check cannot run, so it
 * is not a gate. Five throwaway extractors written across Tasks 22-24 reviews
 * each rebuilt the static half by hand and every one of them matched a word
 * where it should have matched a call. This is that check, committed once.
 *
 * Layering: this module lives under `src/cli/` rather than `src/engine/`
 * precisely because it imports `checkpointIds` from `src/server/session.ts`.
 * The CLI is the top layer and may depend on both engine and server; an
 * `src/engine/` module reaching into `src/server/` would be backwards. Moving
 * `checkpointIds` into the engine would be the tidier fix, but `session.ts`
 * closed after six review rounds and four fix rounds on that one function, and
 * a re-home there buys nothing this placement does not.
 */

export type HeaderKind = 'baseline-fail' | 'expect-fail' | 'unprobed-invariant'

export interface HeaderRecord {
  kind: HeaderKind
  /**
   * Declared checkpoints as `id@phase`, **sorted** — `fs-home-size@post`,
   * `lv-home-size@both`. Header order carries no meaning (`expectedStatus` looks
   * ids up by `find` and `parseExpectations` already rejects a repeat), so
   * sorting is lossless and keeps a reordered header from showing up as fixture
   * drift a reviewer has to read past.
   *
   * **The phase is part of the record, and the field is named `declared` rather
   * than `ids` to keep it that way.** An earlier version stored bare ids, which
   * made the golden fixture blind to the one distinction this project exists to
   * teach: `@pre` versus `@post` is verdict A versus verdict B, "it works now"
   * versus "it survives a reboot". Flipping a shipped `fs-home-size@post` to
   * `@pre` inverts an anti-solution's persistence semantics, and every static
   * check stayed green with a byte-identical fixture while `expectedStatus` —
   * which does read the phase — silently changed its verdict. The rename is
   * deliberate: it forces the compiler to flag every site that used to compare
   * these against emitted ids, because a phase-suffixed string must never be
   * compared to a bare emitted id.
   *
   * The default phase is written out as `@both` rather than omitted, so a
   * dropped `@post` reads as `@post` → `@both` in a diff instead of as a
   * suffix appearing from nowhere.
   *
   * `unprobed-invariant` has no phase grammar — `parseUnprobed` splits on commas
   * and nothing else — so its entries are bare ids.
   */
  declared: string[]
}

export interface ScriptRecord {
  /** Path relative to the content root, `/`-separated so the fixture is portable. */
  file: string
  headers: HeaderRecord[]
  /** The distinct ids this script emits, per `checkpointIds`. Sorted. */
  emitted: string[]
}

export interface LintResult {
  /** Anything here is an error and makes the command exit non-zero. */
  problems: string[]
  /**
   * Informational only. Never affects the exit code — and that is safe **because**
   * `resolveUndeclared` no longer files every undeclared id here: the ones nothing
   * in the task names are `problems`. This list is now the anchored-but-undeclared
   * category alone, which is a legitimate authoring shape rather than a defect
   * waiting for someone to read stdout. The name in this comment used to be
   * `checkUndeclared`, a function that does not exist.
   */
  notes: string[]
  /** Every `.sh` under the root carrying a header, sorted by path. */
  inventory: ScriptRecord[]
  gradersChecked: number
}

/**
 * The authoring convention for a checkpoint id: lowercase kebab.
 *
 * This is deliberately **stricter** than `CK_CALL`'s id class in
 * `src/server/session.ts`, which accepts `_` and uppercase, and the asymmetry is
 * the design rather than an oversight. A *counter* that cannot see an id fails
 * **open**: `expectedTotal` lands low, a truncated grader run reads as complete,
 * and the student is told they passed a checkpoint that never ran. A *validator*
 * that rejects an id fails **closed**: one loud authoring error, here, before any
 * VM is involved. So the counter is wide on purpose and enforcement lives in this
 * file. `session.ts`'s own docstring names this lint as the loud half.
 */
const KEBAB_ID = /^[a-z0-9][a-z0-9-]*$/

/**
 * A `ck`-shaped call and the first word after it. The anchor set is copied from
 * `CK_CALL` in `src/server/session.ts` on purpose, so the two agree about where a
 * call may begin.
 *
 * This finds **candidates only**. Whether a candidate is real code or text inside
 * a comment, a quoted run or a heredoc body is not decided here — `nonLiteralIds`
 * decides it by re-running `checkpointIds` over a mutated copy of the script. That
 * keeps this pattern from becoming a sixth private opinion about bash's lexical
 * rules, which is how the five throwaway extractors went wrong.
 */
const CK_ID_WORD =
  /(?:^|[;&|{()])[ \t]*(?:(?:then|do|else)[ \t]+)?ck(?:_pass|_fail|_skip)?[ \t]+(["']?)([^ \t;&|()]*)/g

/**
 * `ck` calls whose id is not a literal — `ck "$id"`, `ck ${name}`, `ck "size-$n"`.
 *
 * `countCheckpoints` cannot see these by design: `CK_CALL`'s id class starts at
 * `[A-Za-z0-9_]`, so a `$` yields no id at all and a literal prefix yields a
 * truncated one. Either way the grader declares fewer checkpoints than it emits,
 * `expectedTotal` lands low, and a truncated run reads as complete. That is
 * fail-open and silent, which is exactly what a static lint is for.
 *
 * The mutation probe is the load-bearing part. A candidate is rewritten to a
 * sentinel *literal* id and the real `checkpointIds` is re-run over the whole
 * script; if the sentinel comes back, the call site is code the counter would have
 * read, so the non-literal id there is a real miss. If it does not, the candidate
 * was a comment, a quoted string or a heredoc body, and there is nothing to
 * report. This borrows the scanner's knowledge of bash's lexical rules instead of
 * restating it.
 */
function nonLiteralIds(script: string): string[] {
  const lines = script.split('\n')
  const found: string[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    for (const m of line.matchAll(CK_ID_WORD)) {
      const quote = m[1] ?? ''
      const word = m[2] ?? ''
      // Command substitution counts as non-literal for the same reason a
      // variable does: the id is not in the text.
      if (!word.includes('$') && !word.includes('`')) continue

      const end = m.index + m[0].length
      const start = end - word.length - quote.length
      // Position-derived, so two candidates on one line cannot collide, and
      // valid under CK_CALL's id class.
      const probe = `lintprobe${i}x${start}`
      const mutant = [...lines]
      mutant[i] = line.slice(0, start) + probe + line.slice(end)

      if (checkpointIds(mutant.join('\n')).includes(probe)) found.push(`${quote}${word}`)
    }
  }

  return found
}

/**
 * A line that only sets shell options: `set -e`, `set -euo pipefail`, `set +x`.
 *
 * Deliberately narrow. This decides what `changesNothing` is allowed to *ignore*,
 * so widening it makes that rule fire more often — a false fail on the bank — while
 * keeping it narrow only ever leaves a no-op fixture unreported. The `[-+]` covers
 * both directions of an option, and `[^;&|]*$` anchors the match to the end of the
 * line: a real command joined on with `;`, `&&` or `||` breaks the match, so the
 * line is judged as code rather than discarded with the option prefix.
 *
 * This used to be start-anchored only (`/^set\s+[-+]/`), with no trailing `$` and
 * no exclusion of `;`. `.test()` only needs a match to exist anywhere in the
 * string, so `set -euo pipefail; sudo lvextend -L 12G /dev/rhel/home` matched on
 * the `set -` prefix alone and `changesNothing` discarded the **whole line** —
 * including the real command after the `;` — as a no-op. That is the opposite of
 * narrow: it silently swallowed a command the same way a start-anchor was meant to
 * keep out.
 *
 * Excluding only `;` left the two shell-idiomatic joiners open: a fixture body of
 * `set -euo pipefail && sudo lvextend -L 12G /dev/rhel/home` still matched — `&&`
 * is *more* idiomatic than `;` under `set -e`, so this was the likelier shape, not
 * an edge case — and `changesNothing` discarded the real command after it, the
 * identical false fail, with this rule named in the message. `[^;&|]*$` closes
 * both `&&` and `||` the same way it closes `;`.
 */
const SHELL_OPTION_LINE = /^set\s+[-+][^;&|]*$/

/**
 * Whether a fixture body could not have changed the machine: nothing in it but
 * comments, blank lines and shell options.
 *
 * Text-only, no execution, no guest. It is deliberately not a general "is this a
 * no-op" question — a command that runs and happens to be a no-op *on this machine*
 * is a runtime comparison against the baseline, which lives in `runFixture` and not
 * here. This is only the case where there is no command at all.
 */
function changesNothing(script: string): boolean {
  for (const raw of script.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || SHELL_OPTION_LINE.test(line)) continue
    return false
  }
  return true
}

/** Every `.sh` under `dir`, recursively. Sorted by the caller, because readdir order is not guaranteed. */
async function shellScripts(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await shellScripts(full)))
    else if (entry.isFile() && entry.name.endsWith('.sh')) out.push(full)
  }
  return out
}

function checkDeclaredAreEmitted(
  declared: string[],
  emitted: Set<string>,
  kind: HeaderKind,
  where: string,
  problems: string[],
): void {
  for (const id of declared) {
    if (!emitted.has(id)) {
      problems.push(`${where}: ${kind} names ${id}, which the grader never emits`)
    }
  }
}

/**
 * The content root's task directories, as `<root>/tasks/<area>/<task>`.
 *
 * Derived from the location of each `grade.sh` rather than from `loadBank`, so a
 * YAML error anywhere in the bank does not block the script lint. The two are
 * independent gates and coupling them would mean neither runs when the other's
 * input is broken.
 */
function taskDirOf(gradeScript: string): string {
  return gradeScript.slice(0, gradeScript.length - '/grade.sh'.length)
}

/**
 * One fixture directory, with "absent" and "unreadable" kept apart from "empty".
 *
 * `loadTaskScripts` reads these with `readdir(dir).catch(() => [])`, so ENOENT, a
 * permission error and a genuinely empty directory all arrive as zero fixtures.
 * That is the swallow `docs/r1-findings.md` diagnoses as *"the directory name is
 * misspelled"* with a human checking the spelling as its remedy. Distinguishing
 * the three here is what lets the message say which one happened.
 *
 * An entry that is not a file is `unexpected` regardless of its name: a directory
 * called `foo.sh` passes `loadTaskScripts`'s `.endsWith('.sh')` filter and then
 * fails on `readFile`.
 */
type FixtureDir =
  | { kind: 'absent' }
  | { kind: 'unreadable'; message: string }
  | { kind: 'read'; scripts: string[]; unexpected: string[] }

function isEnoent(e: unknown): boolean {
  if (typeof e !== 'object' || e === null || !('code' in e)) return false
  const code: unknown = e.code
  return code === 'ENOENT'
}

/**
 * A regular file at this exact path. `stat` rather than `access`, because a
 * *directory* named `setup.sh` is not a script the loader can read, and `access`
 * would say it is there.
 */
async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function scanFixtureDir(dir: string): Promise<FixtureDir> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (e) {
    if (isEnoent(e)) return { kind: 'absent' }
    return { kind: 'unreadable', message: e instanceof Error ? e.message : String(e) }
  }

  const scripts: string[] = []
  const unexpected: string[] = []
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.sh')) scripts.push(entry.name)
    else unexpected.push(entry.name)
  }
  return { kind: 'read', scripts: scripts.sort(), unexpected: unexpected.sort() }
}

/**
 * The fixture floors, ported from the gate that has never run to the gate that
 * always runs.
 *
 * `inventoryGate` in `src/engine/validate/harness.ts` already treats a thin
 * fixture set as a content defect, so the decision is not re-litigated here — only
 * its location. That gate lives inside `rhcsa validate`, which reverts a snapshot
 * and needs a guest; this one needs neither. `MIN_SOLUTIONS` and
 * `MIN_ANTISOLUTIONS` are imported rather than restated for the same reason
 * `nonLiteralIds` re-runs `checkpointIds` rather than matching ids itself: two
 * copies of a rule drift, and the copy nobody runs drifts first.
 *
 * **Everything here iterates `bank.tasks`, not a directory walk.** A walk cannot
 * notice what it did not find, which is the whole defect being closed: with no
 * expected count, a task whose `antisolutions/` had vanished produced zero
 * anti-solution records, zero problems and exit 0. The bank is the only thing that
 * knows a task is supposed to have fixtures at all.
 */
async function checkFixtureFloors(
  bank: Bank,
  graders: Set<string>,
  rel: (file: string) => string,
  problems: string[],
): Promise<void> {
  const dirs: Array<{ sub: string; floor: number; label: string }> = [
    { sub: 'solutions', floor: MIN_SOLUTIONS, label: 'solutions' },
    { sub: 'antisolutions', floor: MIN_ANTISOLUTIONS, label: 'anti-solution' },
  ]

  for (const task of bank.tasks) {
    const where = rel(task.dir)

    // Derived from the bank, and deliberately not left to the orphan check below.
    // A deleted `grade.sh` is reported there only as `no sibling grade.sh` from
    // each of its now-orphaned anti-solutions — which means the grader half is
    // guarded by the fixture half's files being present, and the fixture half was
    // until now guarded by nothing. Delete both and neither complained.
    if (!graders.has(join(task.dir, 'grade.sh'))) {
      problems.push(
        `${where}: ${task.id} is in the bank but has no grade.sh, so nothing about this task was checked`,
      )
    }

    // `setup.sh` is required by nothing else — not `loadTask`, not `loadBank`, so
    // the bank loads happily without it. `loadTaskScripts` reads it with a bare
    // `readFile` and no `.catch`, unlike the `readdir(dir).catch(() => [])` eleven
    // lines below it, so its absence rejects rather than being swallowed: the lab
    // cannot start and `rhcsa validate` cannot run. That makes this a late failure
    // rather than a silent one, and it is checked here anyway for one reason — this
    // command is the only gate a checkout with no ISO can run, and
    // `docs/exit-criterion.md` sends the reader here before a VM exists. A green
    // result on a task that cannot start is a false green on the bank, which is the
    // third failure direction this project counts.
    if (!(await isFile(join(task.dir, 'setup.sh')))) {
      problems.push(
        `${where}: ${task.id} has no setup.sh, so the lab cannot be started and validate cannot run it`,
      )
    }

    for (const { sub, floor, label } of dirs) {
      const scan = await scanFixtureDir(join(task.dir, sub))

      if (scan.kind === 'unreadable') {
        problems.push(`${where}: ${sub}/ could not be read (${scan.message}), so its fixtures were not counted`)
        continue
      }
      if (scan.kind === 'absent') {
        // Absent covers the misspelling: `antisolutons/` means the directory the
        // loader looks for is gone. Reported instead of the count below rather
        // than as well as it, because "the directory is missing" and "it holds
        // too few files" are one fact here, and two lines for one fact is how a
        // problem list stops being read.
        problems.push(
          `${where}: ${sub}/ is missing. loadTaskScripts swallows the readdir failure, so an absent or ` +
            `misspelled directory name loads zero fixtures and reads exactly like a task with nothing to check.`,
        )
        continue
      }
      if (scan.scripts.length < floor) {
        problems.push(`${where}: needs at least ${floor} ${label}, found ${scan.scripts.length}`)
      }
      for (const name of scan.unexpected) {
        problems.push(
          `${where}: ${sub}/${name} does not end in .sh, so no fixture loads it. Renaming a fixture off .sh ` +
            `drops it from every run without changing a single declared expectation.`,
        )
      }
    }
  }

  // The other direction. `bank.tasks` is itself assembled from a walk for
  // `task.yaml`, so iterating it would close the missing-expectation hole one way
  // only: remove a `task.yaml` and the task leaves the list that drives every rule
  // above, while its `grade.sh` still gets its headers checked and its fixtures
  // get counted by nobody. Reconciling both ways is what stops either half of this
  // command from resting on the other half's files being present.
  const taskDirs = new Set(bank.tasks.map((t) => t.dir))
  for (const grader of graders) {
    if (!taskDirs.has(taskDirOf(grader))) {
      problems.push(
        `${rel(grader)}: no task in the bank owns this grader, so its fixture floors were not checked ` +
          `(a missing or unloadable task.yaml does this)`,
      )
    }
  }
}

/**
 * Decide what an emitted-but-undeclared checkpoint id **is**, once every header in
 * the task has been read.
 *
 * This used to be a note and nothing else, which meant a whole class of defect had
 * no signal at all: rename `home-from-lv` to `home-from-lvm` in a grader and the
 * lint prints one more informational line, exits 0, and nothing anywhere states
 * that a checkpoint the student is scored on is now referenced by nothing. Notes do
 * not fail the gate by design and should not — but the set of note-worthy ids and
 * the set of typos were the same set, so the design was covering for the defect.
 *
 * The ruling, and why this rather than "make it an error": **an id no header in the
 * task names anywhere is an error; an id only a sibling anti-solution's
 * `# expect-fail:` names stays a note.** Reconciling against the note set is what
 * makes the distinction available, and the distinction is real. A grader
 * legitimately emits invariants that pass at the unsolved baseline, so they cannot
 * appear in `# baseline-fail:`; that is not a mistake and failing on it would fail
 * the whole bank. But an anti-solution naming the id *is* a second reference to it
 * — something in the task asserts the checkpoint exists and predicts what it does —
 * so the id is anchored, and a rename breaks the anti-solution check loudly
 * (`# expect-fail: names X, which the grader never emits`) rather than quietly.
 * Measured on today's bank: all three notes are anti-solution-named
 * (`014` `home-from-lv` and `persist-config` via `antisolutions/02`, `017`
 * `default-target` via `antisolutions/03`), so this ships as 0 problems and 3
 * notes with no `content/**` edit. Making every undeclared id an error would have
 * needed three header edits to a bank whose graders are correct, and would have
 * deleted the legitimate category along with the defect.
 *
 * `# unprobed-invariant:` remains the way to say "this is deliberately unprobed",
 * and it is now the *only* way — which is what makes the error actionable: an
 * author reading it either fixes the typo or declares the invariant.
 */
function resolveUndeclared(
  undeclaredByTask: Map<string, { where: string; ids: string[] }>,
  probedByTask: Map<string, Set<string>>,
  problems: string[],
  notes: string[],
): void {
  // Sorted by task directory, because `Map` iteration follows insertion order and
  // the golden fixture and the operator both want a stable transcript.
  for (const dir of [...undeclaredByTask.keys()].sort()) {
    const entry = undeclaredByTask.get(dir)
    if (entry === undefined) continue
    const probed = probedByTask.get(dir) ?? new Set<string>()
    for (const id of entry.ids) {
      if (probed.has(id)) {
        notes.push(
          `${entry.where}: ${id} is emitted but named by no header on this grader; ` +
            `a sibling anti-solution's "# expect-fail:" names it, so it is an invariant that passes at baseline`,
        )
      } else {
        problems.push(
          `${entry.where}: ${id} is emitted but named by no header anywhere in this task — not ` +
            `"# baseline-fail:", not "# unprobed-invariant:", and no anti-solution's "# expect-fail:". ` +
            `Nothing states this checkpoint should exist, so a typo in its id reads as a passing invariant. ` +
            `Declare it, or fix the id.`,
        )
      }
    }
  }
}

export interface LintOptions {
  /**
   * Accept a content root containing no `grade.sh`. Off by default; see the
   * `graders.length === 0` guard in `lintContent` for why.
   */
  allowEmpty?: boolean
}

export async function lintContent(root: string, opts: LintOptions = {}): Promise<LintResult> {
  const problems: string[] = []
  const notes: string[] = []
  const inventory: ScriptRecord[] = []

  const files = (await shellScripts(root)).sort()
  const text = new Map<string, string>()
  for (const file of files) text.set(file, await readFile(file, 'utf8'))

  // `/`-separated regardless of platform, so the golden fixture is portable and
  // does not drift with the absolute path the caller passed in.
  const rel = (file: string) => relative(root, file).split(sep).join('/')

  // Emitted ids per grader, so an anti-solution's `# expect-fail:` can be checked
  // against its sibling grade.sh — which is the script that actually emits, and
  // what `checkEmittedIds` compares against at runtime.
  const emittedByTask = new Map<string, Set<string>>()

  /**
   * Emitted ids no header on the grader itself names, per task, held until the
   * anti-solution loop has run. See `resolveUndeclared` for why the decision
   * cannot be made where the ids are found.
   */
  const undeclaredByTask = new Map<string, { where: string; ids: string[] }>()

  /**
   * Ids some sibling anti-solution's `# expect-fail:` names, per task. Bare ids,
   * not the phase-suffixed `declared` form: these are compared against emitted
   * ids, and `HeaderRecord.declared`'s docstring is explicit that a phase-suffixed
   * string must never be.
   */
  const probedByTask = new Map<string, Set<string>>()
  const graders = files.filter((f) => f.endsWith('/grade.sh'))

  // "Nothing to check" must not be indistinguishable from "all clear".
  //
  // Every check below is a loop over `graders`, so an empty `graders` runs zero
  // checks, collects zero problems and exits 0 — green, from a gate that never
  // looked at anything. A *nonexistent* root already exits 1 because `readdir`
  // throws ENOENT; it is the existing-but-empty case that bites, which is what a
  // moved `content/`, a bad `--content` path or a half-finished checkout produces.
  // A human reading stdout sees `graders checked: 0`, but a CI step, a pre-commit
  // hook or an npm script in a wrapper reads only the exit code.
  //
  // This is the same shape as the fail-open defects this lint exists to catch: a
  // tool reporting success it did not earn. `--allow-empty` exists so the one
  // legitimate case — deliberately linting a root before any task is authored —
  // has to say so out loud.
  if (graders.length === 0 && opts.allowEmpty !== true) {
    problems.push(
      `${root}: no grade.sh found, so nothing was checked. That is not the same as "all clear" — ` +
        `check the content root, or pass --allow-empty if an empty bank is genuinely expected.`,
    )
  }

  // The floors run here, outside any test on `graders`, and that placement is the
  // whole point of them.
  //
  // `graders.length` is a **walk result**. `bank.tasks` is the independent record of
  // what should exist, and it is the one input every rule in `checkFixtureFloors` has
  // **in common** — not the only input any of them reads: `graders` is a second one,
  // read by the `grade.sh` rule and iterated by the orphan reconciliation at the end.
  // So the grader count is not a precondition of the floors — it is one of
  // the things they check, via the `grade.sh` rule. Gating them on it inverted that:
  // a bank still declaring five tasks with every `grade.sh` deleted found zero
  // graders, so the rule that exists to report exactly that never ran. Under
  // `--allow-empty`, which makes zero graders a non-error, the whole command then
  // exited 0 on a bank with no graders and no anti-solutions at all.
  //
  // An earlier version of this comment claimed "a root the walk found no graders in
  // has no task to iterate". That is false — it infers a property of the bank from a
  // result of the walk, which is the reasoning error every rule below exists to
  // close. It is recorded here rather than deleted because the short-circuit it
  // defended is the obvious simplification for the next reader to reach for.
  let bank: Bank | undefined
  try {
    bank = await loadBank(root)
  } catch (e) {
    // "The floors could not be checked" is itself a problem, for the same reason as
    // the guard above: a gate exiting 0 having skipped its checks.
    //
    // This condition is about the **message**, not about the rules. The rules above
    // are not gated on this condition, and nothing here can suppress them; all that
    // is decided here is whether the loader's failure earns a line. It does if the
    // walk found a grader **or** there is a regular file at `<root>/objectives.yaml`.
    //
    // `objectives.yaml` is the discriminator because it is the bank's root manifest —
    // its presence is what separates *"nobody authored a bank here"* from *"a bank is
    // here and would not load"*. `--allow-empty` cannot make that distinction, because
    // it does not assert that the root is unauthored. It asserts **zero graders**, and
    // its own message forty lines above says exactly that: "pass --allow-empty if an
    // empty bank is genuinely expected" — an empty *bank*, meaning no `grade.sh`. It
    // says nothing about `objectives.yaml`, `concepts/` or `task.yaml`.
    //
    // **The named path is load-bearing. Do not "strengthen" it into a walk.**
    // *"There is no file at this fixed path"* is a filesystem fact. *"The walk found
    // no `task.yaml`"* is a precondition computed from the very thing being validated,
    // which is this file's recurring defect one artifact along. The two read almost
    // identically in English and are not the same check. `files.length > 0` is not a
    // substitute either — `emptyRoot()` in `test/cli/lint.test.ts` contains a
    // `setup.sh` and no bank file, and must keep exiting 0.
    //
    // **The residual, which this does narrow rather than close.** Zero graders *and*
    // no regular file at that path still suppresses the message, so the command exits
    // 0 with empty stderr. Measured: that covers an authored root — five `task.yaml`,
    // five `setup.sh`, `concepts/` intact — whose `objectives.yaml` was **deleted**,
    // and the same root with a directory or a broken symlink at that path. (A present
    // but unreadable `objectives.yaml` does report: `stat` succeeds, so `isFile` is
    // true.) Closing that needs an independent record that a bank was meant to exist
    // here, and the only candidate inside this command is a walk — the shape ruled out
    // in the paragraph above. So the channel is narrowed from "any loader failure" to
    // "the discriminator is itself the thing that is missing", and no further.
    //
    // Two earlier versions of this comment were wrong. Both are recorded rather than
    // deleted, because both are what the next reader will reach for:
    //   1. "a root the walk found no graders in has no task to iterate" — false: it
    //      infers a property of the bank from a result of the walk.
    //   2. "when `--allow-empty` says an unauthored root is expected, an unloadable
    //      bank is that assertion being true rather than a defect" — false twice over.
    //      The flag says zero graders, not unauthored; and inferring a property of the
    //      *content* from a failure of the *loader* is (1) one artifact along.
    // Both defended reporting nothing at zero graders. Measured against (2): a bank
    // declaring five tasks with every `grade.sh` deleted plus one ordinary YAML typo
    // exited 0, 0 problems, stderr 0 bytes, under `--allow-empty` — the same channel
    // the unconditional floors above were written to close.
    //
    // With a grader present the bank is a real bank either way, so a bank that will
    // not load is a problem no flag suppresses.
    //
    // The header checks below still run either way, which is the split documented on
    // `taskDirOf`: a YAML error must not take the script lint down with it.
    if (graders.length > 0 || (await isFile(join(root, 'objectives.yaml')))) {
      const detail =
        e instanceof ContentError ? e.problems.join('; ') : e instanceof Error ? e.message : String(e)
      problems.push(`${root}: the bank did not load, so the per-task fixture floors were not checked — ${detail}`)
    }
  }
  if (bank !== undefined) await checkFixtureFloors(bank, new Set(graders), rel, problems)

  for (const grader of graders) {
    emittedByTask.set(taskDirOf(grader), new Set(checkpointIds(text.get(grader) ?? '')))
  }

  for (const grader of graders) {
    const where = rel(grader)
    const script = text.get(grader) ?? ''
    const emitted = emittedByTask.get(taskDirOf(grader)) ?? new Set<string>()

    const baseline = parseDeclaredIds(script, where, 'baseline-fail')
    for (const p of baseline.problems) problems.push(`${where}: ${p}`)
    checkDeclaredAreEmitted(baseline.ids, emitted, 'baseline-fail', where, problems)

    const unprobed = parseUnprobed(script)
    for (const p of unprobed.problems) problems.push(`${where}: ${p}`)
    checkDeclaredAreEmitted(unprobed.ids, emitted, 'unprobed-invariant', where, problems)

    // Authoring grammar. Errors, not notes: a non-conforming id is always a
    // mistake, and it is a mistake that silently degrades the truncation guard
    // rather than announcing itself.
    for (const id of [...emitted].sort()) {
      if (!KEBAB_ID.test(id)) {
        problems.push(
          `${where}: checkpoint id ${JSON.stringify(id)} is not lowercase kebab-case ` +
            `(/^[a-z0-9][a-z0-9-]*$/). countCheckpoints accepts it and miscounts it; this check is the loud half.`,
        )
      }
    }

    // Only graders are scanned for non-literal ids. `content/lib/assert.sh`
    // implements `ck` by forwarding `"$id"` to `ck_pass`, which is a variable id
    // by construction and correctly invisible to the counter; solutions,
    // anti-solutions and setup.sh emit no checkpoints at all.
    for (const raw of nonLiteralIds(script)) {
      problems.push(
        `${where}: checkpoint id ${JSON.stringify(raw)} is not a literal. ` +
          `countCheckpoints cannot see it, so expectedTotal lands low and a truncated run reads as complete.`,
      )
    }

    // Collected, not judged yet: whether an emitted-but-undeclared id is a note or
    // an error depends on the task's **anti-solutions**, which are parsed in the
    // loop below. Deciding here is what made this a note-only check.
    const declared = new Set([...baseline.ids, ...unprobed.ids])
    undeclaredByTask.set(taskDirOf(grader), {
      where,
      ids: [...emitted].filter((id) => !declared.has(id)).sort(),
    })

    const headers: HeaderRecord[] = [{ kind: 'baseline-fail', declared: [...baseline.declared].sort() }]
    if (unprobed.declared.length > 0) {
      headers.push({ kind: 'unprobed-invariant', declared: [...unprobed.declared].sort() })
    }
    inventory.push({ file: where, headers, emitted: [...emitted].sort() })
  }

  for (const file of files) {
    if (!file.includes('/antisolutions/')) continue
    const where = rel(file)
    const script = text.get(file) ?? ''
    // <root>/tasks/<area>/<task>/antisolutions/NN-x.sh -> <root>/tasks/<area>/<task>
    const emitted = emittedByTask.get(dirname(dirname(file)))

    const expected = parseDeclaredIds(script, where, 'expect-fail')
    for (const p of expected.problems) problems.push(`${where}: ${p}`)

    // Every id this anti-solution predicts, whether or not the grader emits it.
    // Recorded before the emitted-id check below so a `# expect-fail:` naming an id
    // the grader never emits is reported by that check rather than being silently
    // promoted into "something probes this".
    const taskDir = dirname(dirname(file))
    let probed = probedByTask.get(taskDir)
    if (probed === undefined) {
      probed = new Set<string>()
      probedByTask.set(taskDir, probed)
    }
    for (const id of expected.ids) probed.add(id)

    if (emitted === undefined) {
      problems.push(`${where}: no sibling grade.sh, so its "# expect-fail:" ids cannot be checked`)
    } else {
      checkDeclaredAreEmitted(expected.ids, emitted, 'expect-fail', where, problems)
    }

    // An anti-solution exists to prove the grader **detects** a specific wrong answer.
    // `runFixture` in `src/engine/validate/harness.ts` resets, runs `setup.sh`, runs
    // the fixture, grades, and compares the verdict against the `# expect-fail:` ids
    // above — and nothing anywhere establishes that applying the fixture changed the
    // machine. At the unsolved baseline the goal checkpoints already fail, which is
    // exactly what the header declares, so a fixture that does nothing is certified as
    // a working detector. It is green because the task is unsolved, not because the
    // grader caught anything: a false green on the bank.
    //
    // This is the natural shape of a half-written anti-solution rather than an exotic
    // one. `# expect-fail:` is **itself a comment**, so the authoring order every
    // fixture in this bank follows — shebang, explanatory paragraph, header,
    // `set -euo pipefail`, then the command — satisfies the header rule above one line
    // before the fixture does anything. Bash then exits 0 having run nothing, and the
    // exit-code check in `harness.ts` catches a fixture that *errors*, not one that
    // succeeds at nothing.
    //
    // Solutions are out of scope on purpose: a solution that does nothing fails its
    // own grader, which is loud. Only an anti-solution is graded against a prediction
    // the baseline already satisfies.
    if (changesNothing(script)) {
      problems.push(
        `${where}: nothing here but comments and shell options, so this anti-solution changes nothing. ` +
          `Its "# expect-fail:" ids already fail at the unsolved baseline and no run compares against ` +
          `that baseline, so a fixture that does nothing is certified as a working detector.`,
      )
    }

    inventory.push({
      file: where,
      headers: [{ kind: 'expect-fail', declared: [...expected.declared].sort() }],
      emitted: [...checkpointIds(script)].sort(),
    })
  }

  resolveUndeclared(undeclaredByTask, probedByTask, problems, notes)

  inventory.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
  return { problems, notes, inventory, gradersChecked: graders.length }
}
