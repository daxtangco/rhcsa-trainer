import { describe, expect, it } from 'vitest'
import {
  advance,
  canAdvance,
  deriveRating,
  MAX_RUNG,
  startLadder,
  type RatingInput,
} from '../../src/engine/disclosure/ladder.ts'

describe('MAX_RUNG', () => {
  it('caps each mode per spec section 7', () => {
    expect(MAX_RUNG.practice).toBe(5)
    expect(MAX_RUNG.drill).toBe(3)
    expect(MAX_RUNG.exam).toBe(2)
  })
})

describe('ladder navigation', () => {
  it('starts cold at rung 1', () => {
    expect(startLadder('practice')).toEqual({ mode: 'practice', rung: 1 })
  })

  it('advances one rung at a time and does not mutate the input', () => {
    const a = startLadder('practice')
    const b = advance(a)
    expect(b.rung).toBe(2)
    expect(a.rung).toBe(1)
  })

  it('stops drill at the concept card', () => {
    // Concept cards stay available because a forgotten concept is what drill
    // exists to catch, but command assembly must be unaided.
    let s = startLadder('drill')
    s = advance(s)
    s = advance(s)
    expect(s.rung).toBe(3)
    expect(canAdvance(s)).toBe(false)
    expect(() => advance(s)).toThrow(/rung 3 is the maximum in drill mode/)
  })

  it('stops exam mode at the nudge', () => {
    const s = advance(startLadder('exam'))
    expect(s.rung).toBe(2)
    expect(canAdvance(s)).toBe(false)
    expect(() => advance(s)).toThrow(/rung 2 is the maximum in exam mode/)
  })

  it('allows the full ladder in practice mode', () => {
    let s = startLadder('practice')
    for (let i = 0; i < 4; i++) s = advance(s)
    expect(s.rung).toBe(5)
    expect(canAdvance(s)).toBe(false)
  })
})

describe('deriveRating', () => {
  const base: RatingInput = {
    rungUsed: 1,
    passed: true,
    anyPassed: true,
    durationS: 300,
    timeBudgetS: 480,
    hadRegression: false,
  }

  it('gives easy for solving cold inside the time budget', () => {
    expect(deriveRating(base)).toBe('easy')
  })

  it('gives good for solving cold but over budget', () => {
    expect(deriveRating({ ...base, durationS: 900 })).toBe('good')
  })

  it('gives easy for solving cold exactly at the time budget', () => {
    // The boundary: finishing at exactly the limit is still competent, not rushed.
    expect(deriveRating({ ...base, durationS: base.timeBudgetS })).toBe('easy')
  })

  it('gives good when only a nudge was needed', () => {
    expect(deriveRating({ ...base, rungUsed: 2 })).toBe('good')
  })

  it('gives hard when the concept card was needed', () => {
    expect(deriveRating({ ...base, rungUsed: 3 })).toBe('hard')
  })

  it('gives hard for a partial pass', () => {
    expect(deriveRating({ ...base, passed: false, anyPassed: true })).toBe('hard')
  })

  it('gives again when nothing passed', () => {
    expect(deriveRating({ ...base, passed: false, anyPassed: false })).toBe('again')
  })

  it('gives again when the command sketch or full solution was needed', () => {
    expect(deriveRating({ ...base, rungUsed: 4 })).toBe('again')
    expect(deriveRating({ ...base, rungUsed: 5 })).toBe('again')
  })

  it('gives again for any reboot regression, even on an otherwise clean solve', () => {
    // Believing you are finished before making it permanent is the single most
    // common way a competent candidate fails, so it outranks everything else.
    expect(deriveRating({ ...base, hadRegression: true })).toBe('again')
  })

  it('lets a regression outrank a fast cold solve', () => {
    expect(
      deriveRating({ ...base, rungUsed: 1, durationS: 10, hadRegression: true }),
    ).toBe('again')
  })
})
