export type CheckpointStatus = 'pass' | 'fail' | 'skip'

export interface Checkpoint {
  id: string
  desc: string
  status: CheckpointStatus
  detail?: string
  weight?: number
}

export interface Verdict {
  checkpoints: Checkpoint[]
  /** Lines that were not valid checkpoints. Kept for debugging graders. */
  noise: string[]
}

const STATUSES: readonly string[] = ['pass', 'fail', 'skip']

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asCheckpoint(v: unknown): Checkpoint | undefined {
  if (!isRecord(v)) return undefined
  if (typeof v.id !== 'string' || v.id === '') return undefined
  if (typeof v.desc !== 'string') return undefined
  if (typeof v.status !== 'string' || !STATUSES.includes(v.status)) return undefined

  const cp: Checkpoint = { id: v.id, desc: v.desc, status: v.status as CheckpointStatus }
  if (typeof v.detail === 'string') cp.detail = v.detail
  if (typeof v.weight === 'number') cp.weight = v.weight
  return cp
}

/**
 * Parse a grader's stdout. Never throws: graders are shell scripts on a real
 * machine and will emit stray warnings, so unparseable lines are collected as
 * noise rather than allowed to destroy a valid grading run.
 */
export function parseVerdict(stdout: string): Verdict {
  const checkpoints: Checkpoint[] = []
  const noise: string[] = []

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      noise.push(line)
      continue
    }

    const cp = asCheckpoint(parsed)
    if (cp) checkpoints.push(cp)
    else noise.push(line)
  }

  return { checkpoints, noise }
}

/** Checkpoint ids emitted more than once. A grader authoring bug. */
export function duplicateIds(v: Verdict): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const cp of v.checkpoints) {
    if (seen.has(cp.id)) dupes.add(cp.id)
    seen.add(cp.id)
  }
  return [...dupes]
}

/**
 * True only when there is at least one checkpoint and every one passed.
 * `skip` deliberately does not count as a pass: a grader that skips its way
 * to green is the false-positive failure mode the spec cares most about.
 */
export function allPassed(v: Verdict): boolean {
  return v.checkpoints.length > 0 && v.checkpoints.every((cp) => cp.status === 'pass')
}

/**
 * Last-wins on a duplicate id. `duplicateIds` is the mandatory gate that
 * rejects a grader emitting an id twice, so this never has to arbitrate a
 * real conflict — last-wins is just the cheapest consistent rule.
 */
export function statusById(v: Verdict): Map<string, CheckpointStatus> {
  return new Map(v.checkpoints.map((cp) => [cp.id, cp.status]))
}
