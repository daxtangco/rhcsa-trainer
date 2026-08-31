import { ContentError } from '../content/errors.ts'

export type ExpectPhase = 'pre' | 'post' | 'both'

export interface ExpectedFailure {
  id: string
  phase: ExpectPhase
}

const PHASES: readonly ExpectPhase[] = ['pre', 'post', 'both']

// Exhaustive by construction, the same way `ladder.ts`'s `RUNGS` is: adding an
// ExpectPhase fails to typecheck until it is listed here. Unlike `RUNGS`,
// `PHASES`' own order carries no meaning — `isPhase` only ever tests membership
// via `.some()` — so the reason it stays a `readonly ExpectPhase[]` rather than
// converting to `Record<ExpectPhase, true>`, unlike the four sites this fix round
// did convert, is consistency with `RUNGS` rather than an ordering need of its own.
const _phasesExhaustive: Record<ExpectPhase, true> = { pre: true, post: true, both: true }

function isPhase(v: string): v is ExpectPhase {
  return PHASES.some((p) => p === v)
}

function headerRe(name: 'expect-fail' | 'baseline-fail', flags: string): RegExp {
  return new RegExp(`^#\\s*${name}:(.*)$`, flags)
}

/**
 * Read declared failures from a `# expect-fail:` header.
 *
 * Declaring the phase per checkpoint rather than per file is deliberate: an
 * anti-solution that omits --permanent produces checkpoints that are wrong
 * immediately alongside ones that only break after the reboot, and collapsing
 * that to one phase would let a grader pass while failing at the wrong moment.
 *
 * `header` is a parameter because grade.sh uses the identical syntax under a
 * different name (`# baseline-fail:`) to declare which checkpoints must fail
 * before the student does anything. Same grammar, same phases, same parser.
 */
export function parseExpectations(
  script: string,
  where: string,
  header: 'expect-fail' | 'baseline-fail' = 'expect-fail',
): ExpectedFailure[] {
  // A plain exec() without the `g` flag only ever reports the first match,
  // silently dropping a second header line. Count matches ourselves so a
  // duplicated header is a reported problem instead of a lost declaration.
  const matches = script.match(headerRe(header, 'gim'))
  if (!matches || matches.length === 0) {
    throw new ContentError(where, [
      `must declare a "# ${header}:" header naming the checkpoint ids it expects to fail`,
    ])
  }
  if (matches.length > 1) {
    throw new ContentError(where, [`more than one "# ${header}:" header found`])
  }

  const match = headerRe(header, 'im').exec(script)
  const body = (match?.[1] ?? '').trim()
  if (body === '') {
    throw new ContentError(where, [`"# ${header}:" must name at least one checkpoint id`])
  }

  const problems: string[] = []
  const declared: ExpectedFailure[] = []
  const seen = new Set<string>()

  for (const rawEntry of body.split(',')) {
    const entry = rawEntry.trim()
    if (entry === '') continue

    const parts = entry.split('@')
    if (parts.length > 2) {
      problems.push(`too many "@" in "${entry}"`)
      continue
    }
    const [idPart = '', phaseRaw] = parts
    const trimmedId = idPart.trim()
    if (trimmedId === '') {
      problems.push(`empty checkpoint id in "${entry}"`)
      continue
    }

    const phase = phaseRaw === undefined ? 'both' : phaseRaw.trim()
    if (!isPhase(phase)) {
      problems.push(`unknown phase "${phase}" for ${trimmedId} (use pre, post or both)`)
      continue
    }

    if (seen.has(trimmedId)) {
      problems.push(`checkpoint declared twice: ${trimmedId}`)
      continue
    }
    seen.add(trimmedId)
    declared.push({ id: trimmedId, phase })
  }

  if (problems.length > 0) throw new ContentError(where, problems)
  return declared
}

/** What the harness requires of this checkpoint in this verdict. */
export function expectedStatus(
  declared: ExpectedFailure[],
  id: string,
  verdict: 'A' | 'B',
): 'pass' | 'fail' {
  const hit = declared.find((d) => d.id === id)
  if (!hit) return 'pass'
  if (hit.phase === 'both') return 'fail'
  if (hit.phase === 'post') return verdict === 'B' ? 'fail' : 'pass'
  return verdict === 'A' ? 'fail' : 'pass'
}

/** `# unprobed-invariant:` is optional, so it gets its own parser rather than `parseExpectations`, which throws when its header is absent. */
function unprobedRe(flags: string): RegExp {
  return new RegExp('^#[ \\t]*unprobed-invariant:(.*)$', flags)
}

export interface ParsedHeader {
  /** Bare ids. This is the only form that may be compared against emitted ids. */
  ids: string[]
  /** `id@phase` for the inventory. Same ids, same order, phase retained. */
  declared: string[]
  problems: string[]
}

/**
 * Read `# unprobed-invariant:`, which declares checkpoints the grader emits but
 * knowingly does not probe. Absent is legal and means "none". A duplicate is
 * reported for the same reason `parseExpectations` reports one: a second header
 * line silently loses the first declaration.
 *
 * This lives here rather than in `src/cli/lint.ts`, where it was written, because
 * `declaredCheckpointIds` below needs it on the **runtime grading path** as well as
 * in the lint. Two copies of a header parser in a project whose core gate is a
 * parser is how the five throwaway extractors went wrong; it was moved, not copied.
 */
export function parseUnprobed(script: string): ParsedHeader {
  const matches = script.match(unprobedRe('gim'))
  if (matches === null || matches.length === 0) return { ids: [], declared: [], problems: [] }
  if (matches.length > 1) {
    return { ids: [], declared: [], problems: ['more than one "# unprobed-invariant:" header found'] }
  }

  const body = (unprobedRe('im').exec(script)?.[1] ?? '').trim()
  if (body === '') {
    return { ids: [], declared: [], problems: ['"# unprobed-invariant:" must name at least one checkpoint id'] }
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
  // No phase grammar on this header, so `declared` is the bare ids.
  return { ids, declared: [...ids], problems }
}

/** `parseExpectations` throws an aggregating ContentError; callers that must not stop at the first bad file collect instead. */
export function parseDeclaredIds(
  script: string,
  where: string,
  header: 'expect-fail' | 'baseline-fail',
): ParsedHeader {
  try {
    const decl = parseExpectations(script, where, header)
    return {
      ids: decl.map((d) => d.id),
      declared: decl.map((d) => `${d.id}@${d.phase}`),
      problems: [],
    }
  } catch (e) {
    if (e instanceof ContentError) return { ids: [], declared: [], problems: e.problems }
    throw e
  }
}

/**
 * Every checkpoint id a grade script **declares about itself**: the union of its
 * `# baseline-fail:` and `# unprobed-invariant:` ids.
 *
 * This is the *second witness* to how many checkpoints a grader emits, and its
 * whole value is that it is independent of the first. `countCheckpoints` in
 * `src/server/session.ts` lexes bash; this reads two comment lines. A heredoc
 * fail-open — measured on `content/tasks/selinux/019-httpd-alt-port/grade.sh`,
 * one injected `cat <<NOPE` after the first `ck` — swallows the remainder of the
 * file and takes the lexer's count from 8 to 1, while these two headers still name
 * all 8. Nothing that truncates the lexer's view of the script truncates a header
 * it has already read.
 *
 * **An empty result means "this grader declares nothing", not "this grader is
 * suspect".** A grade script legitimately may carry neither header, so absence is
 * absence of a second witness and the caller's correct posture is to make no
 * claim — see `checkpointCount`. Every grader in the bank today carries
 * `# baseline-fail:`, and `rhcsa lint` is what keeps it that way.
 *
 * Malformed is folded into absent here, deliberately and in one direction only:
 * this function is a **cross-check**, and a cross-check that reports a defect it
 * cannot substantiate is a false fail on a correct run — the mistake the whole
 * truncation guard exists to avoid. The loud half lives in `rhcsa lint`, which
 * reports every one of these problems by path and exits 1, so malformed headers
 * cannot reach a student's session in shipped content. That is the same
 * counter-versus-validator asymmetry `KEBAB_ID` documents one file along.
 */
export function declaredCheckpointIds(gradeScript: string): string[] {
  const baseline = parseDeclaredIds(gradeScript, 'grade.sh', 'baseline-fail')
  const unprobed = parseUnprobed(gradeScript)
  const ids = new Set([
    ...(baseline.problems.length === 0 ? baseline.ids : []),
    ...(unprobed.problems.length === 0 ? unprobed.ids : []),
  ])
  return [...ids].sort()
}
