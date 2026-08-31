### Task 10: Anti-solution expectation headers

Anti-solutions must declare which checkpoints they expect to fail, so the harness can assert *the right check caught the error*. A grader that fails for the wrong reason is still broken.

**Files:**
- Create: `src/engine/validate/expectations.ts`
- Test: `test/validate/expectations.test.ts`

**Interfaces:**
- Consumes: `ContentError` (T2).
- Produces:
  - `type ExpectPhase = 'pre' | 'post' | 'both'`
  - `interface ExpectedFailure { id: string; phase: ExpectPhase }`
  - `function parseExpectations(script: string, where: string): ExpectedFailure[]`
  - `function expectedStatus(declared: ExpectedFailure[], id: string, verdict: 'A' | 'B'): 'pass' | 'fail'`

**The header format.** A comment line in the anti-solution script:

```bash
# expect-fail: fs-var-size, persist-config@post
```

Each entry is `<checkpoint-id>` with an optional `@pre`, `@post`, or `@both` suffix (default `both`).

| Phase | Verdict A | Verdict B | The failure mode it models |
|---|---|---|---|
| `both` | fail | fail | Plainly wrong work — e.g. resized the LV, never grew the filesystem |
| `post` | **pass** | fail | **The persistence signature** — works now, gone after reboot |
| `pre` | fail | pass | Rare; something the reboot repairs |

`post` is the important one and the reason phase is per-checkpoint rather than per-file: an anti-solution that forgets `--permanent` produces a mix of checkpoints, some wrong immediately and some only after the reboot. A per-file phase could not express that, and would let the harness accept a grader that failed at the wrong moment.

- [ ] **Step 1: Write the failing test**

`test/validate/expectations.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ContentError } from '../../src/engine/content/errors.ts'
import { expectedStatus, parseExpectations } from '../../src/engine/validate/expectations.ts'

describe('parseExpectations', () => {
  it('parses a comma-separated list and defaults the phase to both', () => {
    const declared = parseExpectations(
      ['#!/bin/bash', '# expect-fail: fs-var-size, lv-var-size', 'lvextend -L 6G /dev/rhel/var'].join(
        '\n',
      ),
      'a.sh',
    )
    expect(declared).toEqual([
      { id: 'fs-var-size', phase: 'both' },
      { id: 'lv-var-size', phase: 'both' },
    ])
  })

  it('parses per-checkpoint phase suffixes', () => {
    const declared = parseExpectations(
      '# expect-fail: persist-config@both, var-from-lv@post, weird@pre',
      'a.sh',
    )
    expect(declared).toEqual([
      { id: 'persist-config', phase: 'both' },
      { id: 'var-from-lv', phase: 'post' },
      { id: 'weird', phase: 'pre' },
    ])
  })

  it('tolerates extra whitespace and a missing shebang', () => {
    expect(parseExpectations('#   expect-fail:   a@post   ', 'a.sh')).toEqual([
      { id: 'a', phase: 'post' },
    ])
  })

  it('rejects a script with no expect-fail header', () => {
    // An anti-solution that declares nothing cannot validate anything, so it
    // would silently weaken the harness rather than fail loudly.
    const err = (() => {
      try {
        parseExpectations('#!/bin/bash\nlvextend -L 6G /dev/rhel/var\n', 'a.sh')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError

    expect(err).toBeInstanceOf(ContentError)
    expect(err.problems.join('\n')).toMatch(/must declare a "# expect-fail:" header/)
  })

  it('reads an alternate header name, which grade.sh uses for its baseline', () => {
    // Same grammar, same phases — only the label differs.
    expect(
      parseExpectations(
        '# baseline-fail: lv-var-size, var-from-lv@post\n',
        'grade.sh',
        'baseline-fail',
      ),
    ).toEqual([
      { id: 'lv-var-size', phase: 'both' },
      { id: 'var-from-lv', phase: 'post' },
    ])
  })

  it('does not confuse the two header names', () => {
    expect(() => parseExpectations('# baseline-fail: a\n', 'grade.sh')).toThrow(
      /"# expect-fail:" header/,
    )
  })

  it('rejects an empty header', () => {
    const err = (() => {
      try {
        parseExpectations('# expect-fail:', 'a.sh')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError
    expect(err.problems.join('\n')).toMatch(/must name at least one checkpoint/)
  })

  it('rejects an unknown phase', () => {
    const err = (() => {
      try {
        parseExpectations('# expect-fail: a@sometimes', 'a.sh')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError
    expect(err.problems.join('\n')).toMatch(/unknown phase "sometimes"/)
  })

  it('rejects a duplicated checkpoint id', () => {
    const err = (() => {
      try {
        parseExpectations('# expect-fail: a@pre, a@post', 'a.sh')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError
    expect(err.problems.join('\n')).toMatch(/declared twice: a/)
  })
})

describe('expectedStatus', () => {
  const declared = [
    { id: 'both-one', phase: 'both' as const },
    { id: 'post-one', phase: 'post' as const },
    { id: 'pre-one', phase: 'pre' as const },
  ]

  it('expects undeclared checkpoints to pass in both verdicts', () => {
    expect(expectedStatus(declared, 'untouched', 'A')).toBe('pass')
    expect(expectedStatus(declared, 'untouched', 'B')).toBe('pass')
  })

  it('expects a both-phase failure in A and B', () => {
    expect(expectedStatus(declared, 'both-one', 'A')).toBe('fail')
    expect(expectedStatus(declared, 'both-one', 'B')).toBe('fail')
  })

  it('expects a post-phase checkpoint to pass in A and fail in B', () => {
    // This is the persistence signature and the whole reason verdict B exists.
    expect(expectedStatus(declared, 'post-one', 'A')).toBe('pass')
    expect(expectedStatus(declared, 'post-one', 'B')).toBe('fail')
  })

  it('expects a pre-phase checkpoint to fail in A and pass in B', () => {
    expect(expectedStatus(declared, 'pre-one', 'A')).toBe('fail')
    expect(expectedStatus(declared, 'pre-one', 'B')).toBe('pass')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/validate/expectations.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/validate/expectations.ts'`.

- [ ] **Step 3: Write the implementation**

`src/engine/validate/expectations.ts`:

```ts
import { ContentError } from '../content/errors.ts'

export type ExpectPhase = 'pre' | 'post' | 'both'

export interface ExpectedFailure {
  id: string
  phase: ExpectPhase
}

const PHASES: readonly string[] = ['pre', 'post', 'both']

function headerRe(name: string): RegExp {
  return new RegExp(`^#\\s*${name}:(.*)$`, 'im')
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
  header = 'expect-fail',
): ExpectedFailure[] {
  const match = headerRe(header).exec(script)
  if (!match) {
    throw new ContentError(where, [
      `must declare a "# ${header}:" header naming the checkpoint ids it expects to fail`,
    ])
  }

  const body = (match[1] ?? '').trim()
  if (body === '') {
    throw new ContentError(where, [`"# ${header}:" must name at least one checkpoint id`])
  }

  const problems: string[] = []
  const declared: ExpectedFailure[] = []
  const seen = new Set<string>()

  for (const rawEntry of body.split(',')) {
    const entry = rawEntry.trim()
    if (entry === '') continue

    const [id = '', phaseRaw] = entry.split('@', 2)
    const trimmedId = id.trim()
    if (trimmedId === '') {
      problems.push(`empty checkpoint id in "${entry}"`)
      continue
    }

    const phase = phaseRaw === undefined ? 'both' : phaseRaw.trim()
    if (!PHASES.includes(phase)) {
      problems.push(`unknown phase "${phase}" for ${trimmedId} (use pre, post or both)`)
      continue
    }

    if (seen.has(trimmedId)) {
      problems.push(`checkpoint declared twice: ${trimmedId}`)
      continue
    }
    seen.add(trimmedId)
    declared.push({ id: trimmedId, phase: phase as ExpectPhase })
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 13 new tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/engine/validate test/validate && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(validate): parse anti-solution expect-fail headers

Phase is per checkpoint, not per file, because one anti-solution can produce
both immediately-wrong and only-wrong-after-reboot checkpoints. A missing
header is an error: an anti-solution that declares nothing weakens the harness
silently."
```

---

