import { describe, expect, it } from 'vitest'
import { ContentError } from '../../src/engine/content/errors.ts'
import { loadTask } from '../../src/engine/content/task.ts'

const FIXTURES = new URL('../fixtures/tasks/', import.meta.url).pathname

describe('loadTask', () => {
  it('maps snake_case YAML onto camelCase fields', async () => {
    const t = await loadTask(`${FIXTURES}good`)

    expect(t.id).toBe('storage/014-shrink-home-grow-var')
    expect(t.chapter).toBe(15)
    expect(t.scope).toBe('exam-objective')
    expect(t.objectives).toEqual(['storage.lvm.resize', 'storage.fs.xfs'])
    expect(t.requiresConcepts).toEqual([
      'storage.lvm-abstraction-stack',
      'storage.why-xfs-cannot-shrink',
    ])
    expect(t.timeBudget).toBe(480)
    expect(t.rebootCheck).toBe(true)
    expect(t.requiresDisks).toBe(0)
    expect(t.claims).toEqual(['vg:rhel', 'lv:var'])
    expect(t.transport).toBe('ssh')
    expect(t.prompt).toContain('at least 6 GB')
    expect(t.dir).toBe(`${FIXTURES}good`)
  })

  it('defaults the optional fields', async () => {
    // requires_concepts, editions, claims, transport and reboot_check are all
    // omittable; a task with no concepts is legal, just untaught.
    const t = await loadTask(`${FIXTURES}minimal`)
    expect(t.requiresConcepts).toEqual([])
    expect(t.claims).toEqual([])
    expect(t.transport).toBe('ssh')
    expect(t.rebootCheck).toBe(false)
    expect(t.editions).toEqual([])
  })

  it('reports every problem at once rather than the first', async () => {
    const err = await loadTask(`${FIXTURES}bad`).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ContentError)
    const problems = (err as ContentError).problems.join('\n')

    expect(problems).toMatch(/id/)
    expect(problems).toMatch(/title/)
    expect(problems).toMatch(/chapter/)
    expect(problems).toMatch(/scope/)
    expect(problems).toMatch(/objectives/)
    expect(problems).toMatch(/difficulty/)
    expect(problems).toMatch(/time_budget/)
    expect(problems).toMatch(/weight/)
    expect(problems).toMatch(/reboot_check/)
    expect(problems).toMatch(/transport/)
    expect(problems).toMatch(/prompt/)
    // at least 11 of the 12 problems this fixture contains, all surfaced from one load.
    expect((err as ContentError).problems.length).toBeGreaterThanOrEqual(11)
  })

  it('rejects a difficulty outside 1-5 and a requires_disks above 3', async () => {
    const err = (await loadTask(`${FIXTURES}bad`).catch((e: unknown) => e)) as ContentError
    expect(err.problems.join('\n')).toMatch(/difficulty must be an integer 1-5/)
    // Spec section 4.1's VM design has three spare disk slots, so 4 is unsatisfiable.
    expect(err.problems.join('\n')).toMatch(/requires_disks must be an integer 0-3/)
  })
})
