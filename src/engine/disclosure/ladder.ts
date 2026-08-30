/**
 * Guided mode is deliberately not a LadderMode: it is full disclosure by
 * construction (spec section 7), so representing a ladder there is meaningless.
 */
export type LadderMode = 'practice' | 'drill' | 'exam'

export type Rung = 1 | 2 | 3 | 4 | 5

/**
 * 1 cold, 2 nudge, 3 concept card, 4 command sketch, 5 narrated solution.
 */
export const MAX_RUNG: Record<LadderMode, Rung> = {
  practice: 5,
  drill: 3,
  exam: 2,
}

/**
 * The top of the ladder. `guided` mode sits here by construction, so it needs a
 * name: spelling `5` at each guided-mode branch duplicates `MAX_RUNG.practice`
 * with nothing making the two move together.
 */
export const TOP_RUNG: Rung = 5

/** Every rung, in order. Typed here so no caller needs a cast to build it. */
export const RUNGS: readonly Rung[] = [1, 2, 3, 4, 5]

export interface LadderState {
  mode: LadderMode
  rung: Rung
}

export function startLadder(mode: LadderMode): LadderState {
  return { mode, rung: 1 }
}

export function canAdvance(s: LadderState): boolean {
  return s.rung < MAX_RUNG[s.mode]
}

const NEXT_RUNG: Record<Rung, Rung | undefined> = { 1: 2, 2: 3, 3: 4, 4: 5, 5: undefined }

export function advance(s: LadderState): LadderState {
  const next = NEXT_RUNG[s.rung]
  if (!canAdvance(s) || next === undefined) {
    throw new Error(`rung ${s.rung} is the maximum in ${s.mode} mode`)
  }
  return { mode: s.mode, rung: next }
}

export type Rating = 'again' | 'hard' | 'good' | 'easy'

export interface RatingInput {
  rungUsed: Rung
  /** Every checkpoint passed in the verdict that counts. */
  passed: boolean
  /** At least one checkpoint passed, i.e. the attempt was partial rather than blank. */
  anyPassed: boolean
  durationS: number
  timeBudgetS: number
  /** Any checkpoint went pass to fail across the reboot. */
  hadRegression: boolean
}

/**
 * Ratings are derived, never self-reported (spec section 9.2): self-rating is
 * unreliable and invites gaming. Order matters — the cascade encodes priority.
 */
export function deriveRating(i: RatingInput): Rating {
  // A persistence failure is the most instructive outcome in the system and
  // outranks everything, including an otherwise flawless cold solve.
  if (i.hadRegression) return 'again'
  if (i.rungUsed >= 4) return 'again'
  if (!i.passed && !i.anyPassed) return 'again'
  if (!i.passed) return 'hard'
  if (i.rungUsed === 3) return 'hard'
  if (i.rungUsed <= 1 && i.durationS <= i.timeBudgetS) return 'easy'
  return 'good'
}
