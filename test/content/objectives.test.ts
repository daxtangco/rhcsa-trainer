import { describe, expect, it } from 'vitest'
import { ContentError } from '../../src/engine/content/errors.ts'
import { loadObjectives, parseObjectives } from '../../src/engine/content/objectives.ts'

const FIXTURES = new URL('../fixtures/', import.meta.url).pathname

describe('loadObjectives', () => {
  it('loads and indexes objectives by id', async () => {
    const set = await loadObjectives(`${FIXTURES}objectives-good.yaml`)

    expect(set.version).toBe('rhel9')
    expect(set.source).toMatch(/p\.38/)
    expect(set.objectives).toHaveLength(3)
    expect(set.byId.get('storage.fs.xfs')?.chapters).toEqual([14, 15])
    expect(set.byId.has('users.local.create')).toBe(true)
  })

  it('indexes byId with the same size as objectives, and every objective reachable', async () => {
    const set = await loadObjectives(`${FIXTURES}objectives-good.yaml`)

    expect(set.byId.size).toBe(set.objectives.length)
    for (const o of set.objectives) {
      expect(set.byId.get(o.id)).toBe(o)
    }
  })
})

describe('parseObjectives', () => {
  it('rejects a duplicate objective id', () => {
    const raw = {
      version: 'rhel9',
      source: 'x',
      objectives: [
        { id: 'a.b', text: 'A', chapters: [1] },
        { id: 'a.b', text: 'A again', chapters: [2] },
      ],
    }
    const err = (() => {
      try {
        parseObjectives(raw, 'inline')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError

    expect(err).toBeInstanceOf(ContentError)
    expect(err.problems.join('\n')).toMatch(/duplicate objective id: a\.b/)
  })

  it('reports a three-way collision once and leaves the unique objective unaffected', () => {
    const raw = {
      version: 'rhel9',
      source: 'x',
      objectives: [
        { id: 'a.b', text: 'A', chapters: [1] },
        { id: 'a.b', text: 'A again', chapters: [2] },
        { id: 'c.d', text: 'C', chapters: [3] },
      ],
    }
    const err = (() => {
      try {
        parseObjectives(raw, 'inline')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError

    expect(err).toBeInstanceOf(ContentError)
    const duplicateReports = err.problems.filter((p) => /duplicate objective id: a\.b/.test(p))
    expect(duplicateReports).toHaveLength(1)
    expect(err.problems).toHaveLength(1)
  })

  it('rejects objectives being a mapping instead of a list', () => {
    const raw = {
      version: 'rhel9',
      source: 'x',
      objectives: { 'a.b': { text: 'A', chapters: [1] } },
    }
    const err = (() => {
      try {
        parseObjectives(raw, 'inline')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError

    expect(err).toBeInstanceOf(ContentError)
    expect(err.problems.join('\n')).toMatch(/objectives must be a list/)
  })

  it('rejects an entry that is a bare string instead of a mapping', () => {
    const raw = {
      version: 'rhel9',
      source: 'x',
      objectives: ['storage.lvm.resize'],
    }
    const err = (() => {
      try {
        parseObjectives(raw, 'inline')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError

    expect(err).toBeInstanceOf(ContentError)
    expect(err.problems.join('\n')).toMatch(/objectives\[0\] must be a mapping/)
  })

  it('rejects wrong JS types for id, text, and chapters', () => {
    const raw = {
      version: 'rhel9',
      source: 'x',
      objectives: [{ id: 42, text: ['not', 'a', 'string'], chapters: 15 }],
    }
    const err = (() => {
      try {
        parseObjectives(raw, 'inline')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError

    const p = err.problems.join('\n')
    expect(p).toMatch(/id must be dotted lowercase/)
    expect(p).toMatch(/text must be non-empty/)
    expect(p).toMatch(/chapters must be integers 1-28/)
  })

  it('aggregates five distinct problems spanning top-level and nested fields in one call', () => {
    const raw = {
      objectives: [{ id: 'Bad', text: '', chapters: [99] }],
    }
    const err = (() => {
      try {
        parseObjectives(raw, 'inline')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError

    expect(err.problems).toHaveLength(5)
    const p = err.problems.join('\n')
    expect(p).toMatch(/version/)
    expect(p).toMatch(/source/)
    expect(p).toMatch(/id must be dotted lowercase/)
    expect(p).toMatch(/text must be non-empty/)
    expect(p).toMatch(/chapters must be integers 1-28/)
  })

  it('rejects a malformed id, empty text, and a bad chapter', () => {
    const raw = {
      version: 'rhel9',
      source: 'x',
      objectives: [{ id: 'NotDotted', text: '', chapters: [99] }],
    }
    const err = (() => {
      try {
        parseObjectives(raw, 'inline')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError

    const p = err.problems.join('\n')
    expect(p).toMatch(/id must be dotted lowercase/)
    expect(p).toMatch(/text must be non-empty/)
    expect(p).toMatch(/chapters must be integers 1-28/)
  })

  it('requires version and a non-empty objective list', () => {
    const err = (() => {
      try {
        parseObjectives({ objectives: [] }, 'inline')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError

    const p = err.problems.join('\n')
    expect(p).toMatch(/version/)
    expect(p).toMatch(/source/)
    expect(p).toMatch(/at least one objective/)
  })
})
