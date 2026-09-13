import type { EveryMemberListed } from '../exhaustive.ts'

/**
 * Guided mode is deliberately not a LadderMode: it is full disclosure by
 * construction (spec section 7), so representing a ladder there is meaningless.
 */
export type LadderMode = 'practice' | 'drill' | 'exam'

export type Rung = 1 | 2 | 3 | 4 | 5

/**
 * 1 cold, 2 nudge, 3 concept card, 4 command sketch, 5 narrated solution.
 *
 * What a cap governs is **what the hint endpoint hands you when you ask for
 * it**, not what the app contains. The concept library behind rung 3 is served
 * ungated by `GET /api/concepts/:id` on purpose: this app is meant to replace
 * the book, and a reference you may only reach by failing a hint ladder is a
 * worse book. Exam realism for cards is a UI affordance — the session view must
 * not offer card links in exam mode — not an API gate.
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

/**
 * Every rung, in order.
 *
 * **An ordered tuple with an exhaustiveness assertion, not a `Record<Rung, true>`,
 * and the asymmetry with `STATUSES` / `SCOPES` / `MODES` is deliberate.** Those
 * lists answer "is this a member?", and key order means nothing to them. This one
 * *is a sequence*: `server/app.ts` builds guided mode's full disclosure with
 * `RUNGS.map((r) => rungContent(r, ctx))`, so the array order is the order the
 * student reads the ladder in — cold nudge first, narrated solution last. A record's
 * key order is an implementation detail of its literal, so converting this would
 * rest the reading order of a hint ladder on object key ordering, a weaker
 * guarantee than the array already gives. `NEXT_RUNG` below is a record because it
 * answers a per-rung question and carries no order at all.
 *
 * The old `: readonly Rung[]` annotation was the defect, the same one
 * `readonly string[]` was at the record-shaped sites: it widens every element back
 * to `Rung`, so nothing tied the contents to the union. A sixth rung typechecked
 * everywhere — `MAX_RUNG` is keyed by mode, so it would not have noticed either —
 * while guided mode's `/hint` handed back five rungs out of six with the top of the
 * ladder missing, silently, in the one mode whose entire contract is full
 * disclosure. `as const` is what makes the assertion below bite: it is read off
 * `RUNGS` itself, so a rung dropped from the array is caught as well as one added
 * to the union, which a hand-written second list beside it could not do.
 */
export const RUNGS = [1, 2, 3, 4, 5] as const satisfies readonly Rung[]

/** Unused on purpose: a `Rung` missing from `RUNGS` fails `tsc --noEmit` here. */
type _EveryRungIsListed = EveryMemberListed<Rung, (typeof RUNGS)[number]>

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
