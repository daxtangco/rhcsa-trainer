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
