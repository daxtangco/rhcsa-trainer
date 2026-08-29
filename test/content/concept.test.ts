import { describe, expect, it } from 'vitest'
import { ContentError } from '../../src/engine/content/errors.ts'
import { loadConcept } from '../../src/engine/content/concept.ts'

const FIXTURES = new URL('../fixtures/concepts/', import.meta.url).pathname

describe('loadConcept', () => {
  it('parses front matter and keeps the body prose', async () => {
    const c = await loadConcept(`${FIXTURES}good.md`)

    expect(c.id).toBe('storage.lvm-abstraction-stack')
    expect(c.title).toBe('Physical volumes, volume groups, logical volumes')
    expect(c.rhel).toBe(9)
    expect(c.objectives).toEqual(['storage.lvm.create', 'storage.lvm.resize'])
    expect(c.sources).toEqual(['r9:ch15', 'r10:ch15'])
    expect(c.prerequisites).toEqual(['storage.partitions'])
    expect(c.body).toContain('two-step job')
    expect(c.path).toBe(`${FIXTURES}good.md`)
  })

  it('defaults sources and prerequisites to empty', async () => {
    const c = await loadConcept(`${FIXTURES}minimal.md`)
    expect(c.sources).toEqual([])
    expect(c.prerequisites).toEqual([])
  })

  it('rejects an empty body, because a concept card with no prose teaches nothing', async () => {
    const err = (await loadConcept(`${FIXTURES}bad.md`).catch((e: unknown) => e)) as ContentError
    expect(err).toBeInstanceOf(ContentError)
    expect(err.problems.join('\n')).toMatch(/body must be at least/)
  })

  it('reports id, title, rhel and objectives problems together', async () => {
    const err = (await loadConcept(`${FIXTURES}bad.md`).catch((e: unknown) => e)) as ContentError
    const p = err.problems.join('\n')
    expect(p).toMatch(/id must be dotted lowercase/)
    expect(p).toMatch(/title/)
    expect(p).toMatch(/rhel must be an integer 9-10/)
    expect(p).toMatch(/objectives must be a list of strings/)
  })

  it('rejects an omitted objectives key, because a card with no objectives is unreachable from the disclosure ladder', async () => {
    const err = (await loadConcept(`${FIXTURES}missing-objectives.md`).catch(
      (e: unknown) => e,
    )) as ContentError
    expect(err).toBeInstanceOf(ContentError)
    expect(err.problems).toEqual(['objectives must list at least one objective id'])
  })

  it('rejects an explicit empty objectives list distinctly from the omitted-key case', async () => {
    const err = (await loadConcept(`${FIXTURES}empty-objectives.md`).catch(
      (e: unknown) => e,
    )) as ContentError
    expect(err).toBeInstanceOf(ContentError)
    expect(err.problems).toEqual(['objectives must list at least one objective id'])
  })
})
