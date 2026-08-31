### Task 5: Verdict parser (JSONL → checkpoints)

**Files:**
- Create: `src/engine/grading/verdict.ts`
- Test: `test/grading/verdict.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type CheckpointStatus = 'pass' | 'fail' | 'skip'`
  - `interface Checkpoint { id: string; desc: string; status: CheckpointStatus; detail?: string; weight?: number }`
  - `interface Verdict { checkpoints: Checkpoint[]; noise: string[] }`
  - `function parseVerdict(stdout: string): Verdict`
  - `function duplicateIds(v: Verdict): string[]`
  - `function allPassed(v: Verdict): boolean`
  - `function statusById(v: Verdict): Map<string, CheckpointStatus>`

- [ ] **Step 1: Write the failing test**

`test/grading/verdict.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  allPassed,
  duplicateIds,
  parseVerdict,
  statusById,
} from '../../src/engine/grading/verdict.ts'

describe('parseVerdict', () => {
  it('parses one checkpoint per line', () => {
    const v = parseVerdict(
      [
        '{"id":"lv-var-size","desc":"var LV is >= 6G","status":"pass"}',
        '{"id":"persist-config","desc":"/var mounts at boot","status":"fail","detail":"no entry found"}',
      ].join('\n'),
    )

    expect(v.checkpoints).toHaveLength(2)
    expect(v.checkpoints[0]).toEqual({
      id: 'lv-var-size',
      desc: 'var LV is >= 6G',
      status: 'pass',
    })
    expect(v.checkpoints[1]?.detail).toBe('no entry found')
    expect(v.noise).toEqual([])
  })

  it('keeps non-JSON output as noise instead of throwing', () => {
    // Real graders leak stderr and tool chatter. Losing that output would make
    // a misbehaving grader impossible to debug; throwing would make one stray
    // warning destroy an otherwise valid grading run.
    const v = parseVerdict(
      [
        '  WARNING: device /dev/sdb not found',
        '{"id":"a","desc":"A","status":"pass"}',
        '',
        'not json at all',
      ].join('\n'),
    )

    expect(v.checkpoints).toHaveLength(1)
    expect(v.noise).toEqual(['WARNING: device /dev/sdb not found', 'not json at all'])
  })

  it('treats JSON that is not a checkpoint as noise', () => {
    const v = parseVerdict('{"unrelated":true}\n[1,2,3]')
    expect(v.checkpoints).toEqual([])
    expect(v.noise).toHaveLength(2)
  })

  it('rejects an unknown status as noise rather than inventing a verdict', () => {
    const v = parseVerdict('{"id":"a","desc":"A","status":"probably"}')
    expect(v.checkpoints).toEqual([])
    expect(v.noise).toHaveLength(1)
  })

  it('carries an optional numeric weight through', () => {
    const v = parseVerdict('{"id":"a","desc":"A","status":"pass","weight":3}')
    expect(v.checkpoints[0]?.weight).toBe(3)
  })
})

describe('duplicateIds', () => {
  it('finds repeated checkpoint ids', () => {
    const v = parseVerdict(
      [
        '{"id":"a","desc":"A","status":"pass"}',
        '{"id":"a","desc":"A again","status":"fail"}',
        '{"id":"b","desc":"B","status":"pass"}',
      ].join('\n'),
    )
    // Kept, not thrown: a duplicate is a grader authoring bug for `validate`
    // to catch, and blowing up mid-session would punish the user for it.
    expect(v.checkpoints).toHaveLength(3)
    expect(duplicateIds(v)).toEqual(['a'])
  })

  it('returns empty when ids are unique', () => {
    expect(duplicateIds(parseVerdict('{"id":"a","desc":"A","status":"pass"}'))).toEqual([])
  })
})

describe('allPassed', () => {
  it('is false when any checkpoint failed', () => {
    const v = parseVerdict(
      '{"id":"a","desc":"A","status":"pass"}\n{"id":"b","desc":"B","status":"fail"}',
    )
    expect(allPassed(v)).toBe(false)
  })

  it('treats skip as not-a-pass so a skipped check cannot fake success', () => {
    const v = parseVerdict('{"id":"a","desc":"A","status":"skip"}')
    expect(allPassed(v)).toBe(false)
  })

  it('is false for an empty verdict, because a grader that emitted nothing is broken', () => {
    expect(allPassed(parseVerdict(''))).toBe(false)
  })

  it('is true only when every checkpoint passed', () => {
    const v = parseVerdict(
      '{"id":"a","desc":"A","status":"pass"}\n{"id":"b","desc":"B","status":"pass"}',
    )
    expect(allPassed(v)).toBe(true)
  })
})

describe('statusById', () => {
  it('indexes statuses for comparison between verdict A and B', () => {
    const v = parseVerdict(
      '{"id":"a","desc":"A","status":"pass"}\n{"id":"b","desc":"B","status":"fail"}',
    )
    expect(statusById(v).get('a')).toBe('pass')
    expect(statusById(v).get('b')).toBe('fail')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/grading/verdict.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/grading/verdict.ts'`.

- [ ] **Step 3: Write the implementation**

`src/engine/grading/verdict.ts`:

```ts
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

function asCheckpoint(v: unknown): Checkpoint | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || o.id === '') return undefined
  if (typeof o.desc !== 'string') return undefined
  if (typeof o.status !== 'string' || !STATUSES.includes(o.status)) return undefined

  const cp: Checkpoint = { id: o.id, desc: o.desc, status: o.status as CheckpointStatus }
  if (typeof o.detail === 'string') cp.detail = o.detail
  if (typeof o.weight === 'number') cp.weight = o.weight
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

export function statusById(v: Verdict): Map<string, CheckpointStatus> {
  return new Map(v.checkpoints.map((cp) => [cp.id, cp.status]))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 12 new tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/engine/grading test/grading && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(grading): parse grader JSONL into verdicts

Unparseable lines become noise rather than exceptions, so one stray shell
warning cannot destroy a valid grading run. skip does not count as a pass,
which closes the cheapest route to a false positive."
```

---

