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

  // --- Additions beyond the brief's 13 tests ---

  it('rejects an entry with more than one "@"', () => {
    // entry.split('@', 2) would silently truncate "a@pre@post" to
    // ['a', 'pre'], parsing as the valid {id:'a', phase:'pre'}. A malformed
    // suffix must be reported, not swallowed.
    const err = (() => {
      try {
        parseExpectations('# expect-fail: a@pre@post', 'a.sh')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError
    expect(err).toBeInstanceOf(ContentError)
    expect(err.problems.join('\n')).toMatch(/too many "@" in "a@pre@post"/)
  })

  it('rejects a second matching header line', () => {
    // Without the `g` flag, exec() on headerRe only reads the first match,
    // silently dropping declarations from a second header line.
    const err = (() => {
      try {
        parseExpectations('# expect-fail: a\n# expect-fail: b\n', 'a.sh')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError
    expect(err).toBeInstanceOf(ContentError)
    expect(err.problems.join('\n')).toMatch(/more than one "# expect-fail:" header/)
  })

  it('rejects an empty checkpoint id', () => {
    // An entry like "@post" with no id before the "@" must be reported, not
    // silently dropped.
    const err = (() => {
      try {
        parseExpectations('# expect-fail: @post', 'a.sh')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError
    expect(err).toBeInstanceOf(ContentError)
    expect(err.problems.join('\n')).toMatch(/empty checkpoint id in "@post"/)
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
