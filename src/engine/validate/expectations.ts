import { ContentError } from '../content/errors.ts'

export type ExpectPhase = 'pre' | 'post' | 'both'

export interface ExpectedFailure {
  id: string
  phase: ExpectPhase
}

const PHASES: readonly ExpectPhase[] = ['pre', 'post', 'both']

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
