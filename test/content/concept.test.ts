import { describe, expect, it } from 'vitest'
import { ContentError } from '../../src/engine/content/errors.ts'
import {
  buildConceptGraph,
  loadConcept,
  type ConceptSpec,
} from '../../src/engine/content/concept.ts'

const FIXTURES = new URL('../fixtures/concepts/', import.meta.url).pathname

/**
 * A card reduced to the two fields the graph reads. Built here rather than from
 * a markdown fixture because these tests are about edges, and a directory of
 * twelve near-identical .md files would hide the graph shape each case is
 * describing.
 */
function card(id: string, prerequisites: string[] = []): ConceptSpec {
  return {
    id,
    title: id,
    rhel: 9,
    objectives: ['storage.lvm.resize'],
    sources: [],
    prerequisites,
    body: 'x'.repeat(200),
    path: `/concepts/${id}.md`,
  }
}

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

  it('rejects an omitted objectives key: every concept card must declare at least one objective id', async () => {
    // Not a disclosure-ladder claim — `concept.objectives` has no consumer
    // anywhere in `src/`. Card reachability runs through
    // `task.requiresConcepts`, not this field. This asserts the parser-level
    // rule instead: a card with no declared objective teaches toward nothing
    // `checkCoverage` can validate, so `parseConcept` requires the list to be
    // non-empty at authoring time.
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

describe('buildConceptGraph validation', () => {
  it('accepts a graph whose every edge resolves', () => {
    const graph = buildConceptGraph([card('a.one'), card('a.two', ['a.one'])])
    expect(graph.problems).toEqual([])
    expect(graph.ids).toEqual(['a.one', 'a.two'])
  })

  it('resolves a prerequisite declared by a card that loads later', () => {
    // Prerequisites are unordered, so a forward reference is normal authoring and
    // must not be reported as dangling. A single-pass build would.
    const graph = buildConceptGraph([card('a.one', ['a.two']), card('a.two')])
    expect(graph.problems).toEqual([])
    expect(graph.prerequisitesOf('a.one')).toEqual(['a.two'])
  })

  it('reports an edge to a concept id nothing declares, rather than dropping it silently', () => {
    const graph = buildConceptGraph([card('a.one', ['a.nope'])])
    expect(graph.problems).toEqual(['a.one lists unknown prerequisite: a.nope'])
    // Dropped from the edge list as well, so every id a traversal returns is a
    // real card — the drop is safe *because* it was reported above.
    expect(graph.directPrerequisitesOf('a.one')).toEqual([])
  })

  it('reports the same prerequisite listed twice', () => {
    const graph = buildConceptGraph([card('a.one'), card('a.two', ['a.one', 'a.one'])])
    expect(graph.problems).toEqual(['a.two lists prerequisite a.one twice'])
    expect(graph.directPrerequisitesOf('a.two')).toEqual(['a.one'])
  })

  it('reports a two-card cycle, naming the whole path', () => {
    const graph = buildConceptGraph([card('a.one', ['a.two']), card('a.two', ['a.one'])])
    expect(graph.problems).toEqual(['prerequisite cycle: a.one -> a.two -> a.one'])
  })

  it('reports a card that lists itself as a prerequisite', () => {
    const graph = buildConceptGraph([card('a.one', ['a.one'])])
    expect(graph.problems).toEqual(['prerequisite cycle: a.one -> a.one'])
  })

  it('reports a longer cycle once, not once per member', () => {
    const graph = buildConceptGraph([
      card('a.one', ['a.two']),
      card('a.two', ['a.three']),
      card('a.three', ['a.one']),
    ])
    expect(graph.problems).toEqual(['prerequisite cycle: a.one -> a.two -> a.three -> a.one'])
  })

  it('does not mistake a diamond for a cycle', () => {
    // Two paths reaching the same card is normal and must stay silent: a
    // visited-set-free walk would report `a.four` twice and a colour scheme that
    // never blackens a finished node would call this a cycle.
    const graph = buildConceptGraph([
      card('a.one', ['a.two', 'a.three']),
      card('a.two', ['a.four']),
      card('a.three', ['a.four']),
      card('a.four'),
    ])
    expect(graph.problems).toEqual([])
  })
})

describe('ConceptGraph traversal', () => {
  const graph = buildConceptGraph([
    card('a.leaf'),
    card('a.mid', ['a.leaf']),
    card('a.top', ['a.mid', 'a.leaf']),
    card('a.elsewhere'),
  ])

  it('lists transitive prerequisites with foundations first and the card itself excluded', () => {
    expect(graph.prerequisitesOf('a.top')).toEqual(['a.leaf', 'a.mid'])
    expect(graph.prerequisitesOf('a.leaf')).toEqual([])
  })

  it('returns each prerequisite once even when two paths reach it', () => {
    // `a.top` names `a.leaf` directly *and* reaches it through `a.mid`.
    expect(graph.prerequisitesOf('a.top').filter((id) => id === 'a.leaf')).toHaveLength(1)
  })

  it('throws on an unknown id instead of answering "nothing needed first"', () => {
    expect(() => graph.prerequisitesOf('a.typo')).toThrow(/unknown concept id: a\.typo/)
    expect(graph.has('a.typo')).toBe(false)
  })

  it('terminates on a cyclic graph rather than hanging', () => {
    // The reason traversal is on the graph and not on ConceptSpec.prerequisites.
    // A cycle is a hard problem, but it must not be able to hang the app before
    // anyone gets to read the problem.
    const cyclic = buildConceptGraph([card('a.one', ['a.two']), card('a.two', ['a.one'])])
    expect(cyclic.prerequisitesOf('a.one')).toEqual(['a.two'])
    expect(cyclic.reachableFrom(['a.one'])).toEqual(new Set(['a.one', 'a.two']))
  })

  it('reaches a card only a prerequisite edge points at, and includes the roots', () => {
    expect(graph.reachableFrom(['a.top'])).toEqual(new Set(['a.top', 'a.mid', 'a.leaf']))
  })

  it('leaves a card no path reaches out of the reachable set', () => {
    expect(graph.reachableFrom(['a.top']).has('a.elsewhere')).toBe(false)
  })

  it('skips a root the graph does not know instead of throwing', () => {
    // `checkCoverage` passes task.requiresConcepts straight in, and reports an
    // unknown id there itself as `requires unknown concept`. Throwing here would
    // replace that attributable message with a crash.
    expect(graph.reachableFrom(['a.leaf', 'a.typo'])).toEqual(new Set(['a.leaf']))
  })
})
