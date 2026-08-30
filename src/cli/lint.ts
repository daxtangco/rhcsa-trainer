import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { ContentError } from '../engine/content/errors.ts'
import { parseExpectations } from '../engine/validate/expectations.ts'
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
   * Declared ids, **sorted**. Header order carries no meaning — `expectedStatus`
   * looks ids up by `find` and `parseExpectations` already rejects a repeat — so
   * sorting is lossless and keeps a reordered header from showing up as fixture
   * drift a reviewer has to read past.
   */
  ids: string[]
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
  /** Informational only. Never affects the exit code — see `checkUndeclared`. */
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

/** `# unprobed-invariant:` is optional, so it gets its own parser rather than `parseExpectations`, which throws when its header is absent. */
function unprobedRe(flags: string): RegExp {
  return new RegExp('^#[ \\t]*unprobed-invariant:(.*)$', flags)
}

interface ParsedHeader {
  ids: string[]
  problems: string[]
}

/**
 * Read `# unprobed-invariant:`, which declares checkpoints the grader emits but
 * knowingly does not probe. Absent is legal and means "none". A duplicate is
 * reported for the same reason `parseExpectations` reports one: a second header
 * line silently loses the first declaration.
 */
function parseUnprobed(script: string): ParsedHeader {
  const matches = script.match(unprobedRe('gim'))
  if (matches === null || matches.length === 0) return { ids: [], problems: [] }
  if (matches.length > 1) {
    return { ids: [], problems: ['more than one "# unprobed-invariant:" header found'] }
  }

  const body = (unprobedRe('im').exec(script)?.[1] ?? '').trim()
  if (body === '') {
    return { ids: [], problems: ['"# unprobed-invariant:" must name at least one checkpoint id'] }
  }

  const ids: string[] = []
  const problems: string[] = []
  const seen = new Set<string>()
  for (const raw of body.split(',')) {
    const id = raw.trim()
    if (id === '') continue
    if (seen.has(id)) {
      problems.push(`checkpoint declared twice: ${id}`)
      continue
    }
    seen.add(id)
    ids.push(id)
  }
  return { ids, problems }
}

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

/** `parseExpectations` throws an aggregating ContentError; lint collects instead of stopping at the first bad file. */
function declaredIds(script: string, where: string, header: 'expect-fail' | 'baseline-fail'): ParsedHeader {
  try {
    return { ids: parseExpectations(script, where, header).map((d) => d.id), problems: [] }
  } catch (e) {
    if (e instanceof ContentError) return { ids: [], problems: e.problems }
    throw e
  }
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

export async function lintContent(root: string): Promise<LintResult> {
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
  const graders = files.filter((f) => f.endsWith('/grade.sh'))
  for (const grader of graders) {
    emittedByTask.set(taskDirOf(grader), new Set(checkpointIds(text.get(grader) ?? '')))
  }

  for (const grader of graders) {
    const where = rel(grader)
    const script = text.get(grader) ?? ''
    const emitted = emittedByTask.get(taskDirOf(grader)) ?? new Set<string>()

    const baseline = declaredIds(script, where, 'baseline-fail')
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

    // Informational, and deliberately not an error. A grader legitimately emits
    // invariant checkpoints that must pass at baseline and are therefore absent
    // from `# baseline-fail:` by design; `# unprobed-invariant:` declares the
    // knowingly-unprobed ones. Failing on these would fail every task in the bank.
    const declared = new Set([...baseline.ids, ...unprobed.ids])
    const undeclared = [...emitted].filter((id) => !declared.has(id)).sort()
    for (const id of undeclared) {
      notes.push(`${where}: ${id} is emitted but named by no header (an invariant that passes at baseline)`)
    }

    const headers: HeaderRecord[] = [{ kind: 'baseline-fail', ids: [...baseline.ids].sort() }]
    if (unprobed.ids.length > 0) {
      headers.push({ kind: 'unprobed-invariant', ids: [...unprobed.ids].sort() })
    }
    inventory.push({ file: where, headers, emitted: [...emitted].sort() })
  }

  for (const file of files) {
    if (!file.includes('/antisolutions/')) continue
    const where = rel(file)
    const script = text.get(file) ?? ''
    // <root>/tasks/<area>/<task>/antisolutions/NN-x.sh -> <root>/tasks/<area>/<task>
    const emitted = emittedByTask.get(dirname(dirname(file)))

    const expected = declaredIds(script, where, 'expect-fail')
    for (const p of expected.problems) problems.push(`${where}: ${p}`)

    if (emitted === undefined) {
      problems.push(`${where}: no sibling grade.sh, so its "# expect-fail:" ids cannot be checked`)
    } else {
      checkDeclaredAreEmitted(expected.ids, emitted, 'expect-fail', where, problems)
    }

    inventory.push({
      file: where,
      headers: [{ kind: 'expect-fail', ids: [...expected.ids].sort() }],
      emitted: [...checkpointIds(script)].sort(),
    })
  }

  inventory.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
  return { problems, notes, inventory, gradersChecked: graders.length }
}
