import { describe, expect, it } from 'vitest'
import { EXAM_PASSING_SCORE, EXAM_TOTAL_SCORE } from '../../src/engine/exam/limits.ts'

describe('exam limits', () => {
  it('keeps the passing score at 70% of the total', () => {
    // The ratio is the invariant worth pinning: it is what survives if Red Hat
    // rescales the exam, whereas either number alone does not.
    expect(EXAM_PASSING_SCORE / EXAM_TOTAL_SCORE).toBe(0.7)
  })
})
