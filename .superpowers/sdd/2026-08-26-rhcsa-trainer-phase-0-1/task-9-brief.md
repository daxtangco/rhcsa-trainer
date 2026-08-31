### Task 9: Disclosure ladder and FSRS rating

**Files:**
- Create: `src/engine/disclosure/ladder.ts`, `src/engine/exam/limits.ts`
- Test: `test/disclosure/ladder.test.ts`, `test/exam/limits.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type LadderMode = 'practice' | 'drill' | 'exam'` — note `guided` is deliberately absent
  - `type Rung = 1 | 2 | 3 | 4 | 5`
  - `const MAX_RUNG: Record<LadderMode, Rung>`
  - `interface LadderState { mode: LadderMode; rung: Rung }`
  - `function startLadder(mode: LadderMode): LadderState`
  - `function canAdvance(s: LadderState): boolean`
  - `function advance(s: LadderState): LadderState`
  - `type Rating = 'again' | 'hard' | 'good' | 'easy'`
  - `interface RatingInput { rungUsed: Rung; passed: boolean; anyPassed: boolean; durationS: number; timeBudgetS: number; hadRegression: boolean }`
  - `function deriveRating(i: RatingInput): Rating`
  - `const EXAM_DURATION_MINUTES`, `const EXAM_TOTAL_SCORE`, `const EXAM_PASSING_SCORE` from `src/engine/exam/limits.ts`

**Design note.** `LadderMode` excludes `guided` on purpose. Spec §7 marks guided mode's max rung "n/a" because guided mode *is* full disclosure by construction, so the type system refuses to represent a ladder in guided mode rather than encoding it as a magic number.

- [ ] **Step 1: Write the failing test**

`test/disclosure/ladder.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/disclosure/ladder.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/disclosure/ladder.ts'`.

- [ ] **Step 3: Write the implementation**

`src/engine/disclosure/ladder.ts`:

```ts
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

export function advance(s: LadderState): LadderState {
  if (!canAdvance(s)) {
    throw new Error(`rung ${s.rung} is the maximum in ${s.mode} mode`)
  }
  return { mode: s.mode, rung: (s.rung + 1) as Rung }
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
```

- [ ] **Step 4: Record the exam parameters in one place**

Spec §16 lists the EX200 duration and passing score as Phase 0 deliverables and §13.2 consumes them, but nothing in Phase 1 enforces them. They still need an owner, and this is the only mode-aware module in Phase 1 — it already encodes the per-mode rung caps — so the constants live beside it. The values are an open Phase-0 blocker for the user to confirm, which is why the comment says so and why there is exactly one file to correct.

`src/engine/exam/limits.ts`:

```ts
/**
 * EX200 exam parameters. UNCONFIRMED — Phase 0 blocker: verify against the
 * current Red Hat exam objectives page before Phase 2 builds exam mode.
 * Nothing in Phase 1 enforces these; they exist so there is exactly one
 * place to correct.
 */
export const EXAM_DURATION_MINUTES = 150
export const EXAM_TOTAL_SCORE = 300
export const EXAM_PASSING_SCORE = 210
```

`test/exam/limits.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { EXAM_PASSING_SCORE, EXAM_TOTAL_SCORE } from '../../src/engine/exam/limits.ts'

describe('exam limits', () => {
  it('keeps the passing score at 70% of the total', () => {
    // The ratio is the invariant worth pinning: it is what survives if Red Hat
    // rescales the exam, whereas either number alone does not.
    expect(EXAM_PASSING_SCORE / EXAM_TOTAL_SCORE).toBe(0.7)
  })
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 16 new tests PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/engine/disclosure src/engine/exam test/disclosure test/exam && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(disclosure): add the five-rung ladder and derived FSRS rating

LadderMode excludes guided so the type system refuses to represent a ladder
where the spec says n/a. A reboot regression outranks every other signal in
deriveRating, because failing to persist is the most common way a competent
candidate loses points."
```

---

