import { describe, expect, it } from 'vitest'
import { checkCoverage, loadBank } from '../../src/engine/content/bank.ts'
import { ContentError } from '../../src/engine/content/errors.ts'

const BANK = new URL('../fixtures/bank', import.meta.url).pathname

describe('loadBank', () => {
  it('discovers tasks and concepts recursively and indexes them', async () => {
    const bank = await loadBank(BANK)

    expect(bank.tasks.map((t) => t.id).sort()).toEqual([
      'storage/014-grow-var',
      'users/001-create-account',
    ])
    expect(bank.concepts.map((c) => c.id).sort()).toEqual([
      'storage.lvm-abstraction-stack',
      'storage.orphan-concept',
    ])
    expect(bank.tasksById.get('users/001-create-account')?.chapter).toBe(6)
    expect(bank.conceptsById.get('storage.lvm-abstraction-stack')?.title).toMatch(/Physical/)
    expect(bank.objectives.byId.size).toBe(3)
  })
})

describe('checkCoverage', () => {
  it('reports no problems when every reference resolves', async () => {
    const report = checkCoverage(await loadBank(BANK))
    expect(report.problems).toEqual([])
  })

  it('lists concepts that no task requires', async () => {
    const report = checkCoverage(await loadBank(BANK))
    // Unreferenced cards can never be shown, so they are tracked separately
    // from hard errors rather than ignored.
    expect(report.untaughtConcepts).toEqual(['storage.orphan-concept'])
  })

  it('lists objectives with no exam-objective task', async () => {
    const report = checkCoverage(await loadBank(BANK))
    expect(report.uncoveredObjectives).toEqual(['autofs.maps.configure'])
  })

  it('treats an unresolvable requires_concepts entry as a hard problem', async () => {
    const bank = await loadBank(BANK)
    const task = bank.tasksById.get('storage/014-grow-var')
    if (!task) throw new Error('fixture missing')
    task.requiresConcepts = ['storage.does-not-exist']

    const report = checkCoverage(bank)
    expect(report.problems.join('\n')).toMatch(
      /storage\/014-grow-var requires unknown concept: storage\.does-not-exist/,
    )
  })

  it('treats an unknown objective id on a task as a hard problem', async () => {
    const bank = await loadBank(BANK)
    const task = bank.tasksById.get('users/001-create-account')
    if (!task) throw new Error('fixture missing')
    task.objectives = ['users.nope']

    const report = checkCoverage(bank)
    expect(report.problems.join('\n')).toMatch(
      /users\/001-create-account maps to unknown objective: users\.nope/,
    )
  })

  it('treats a typo\'d objective id on a concept card as a hard problem', async () => {
    // Objective ids are permanent scheduling keys, so a typo'd reference on a
    // card is silent content rot in exactly the way a typo'd reference on a
    // task is — but the concept loop used to read only `prerequisites`, so a
    // card's own `objectives:` list was validated nowhere. `lint:content` and
    // `coverage` both passed and the suite stayed green.
    const bank = await loadBank(BANK)
    const concept = bank.conceptsById.get('storage.lvm-abstraction-stack')
    if (!concept) throw new Error('fixture missing')
    concept.objectives = ['storage.typo']

    const report = checkCoverage(bank)
    expect(report.problems.join('\n')).toMatch(
      /storage\.lvm-abstraction-stack maps to unknown objective: storage\.typo/,
    )
  })

  it('does not let a concept card claim objective coverage on its own', async () => {
    // A card's objectives: list is validated above, but it must not feed
    // coveredObjectives — coverage is a property of exam-objective tasks
    // (spec 6.4). Pointing a card at the one objective no task covers must not
    // make it disappear from uncoveredObjectives.
    const bank = await loadBank(BANK)
    const concept = bank.conceptsById.get('storage.lvm-abstraction-stack')
    if (!concept) throw new Error('fixture missing')
    concept.objectives = ['autofs.maps.configure']

    const report = checkCoverage(bank)
    expect(report.uncoveredObjectives).toEqual(['autofs.maps.configure'])
  })

  it('treats an unresolvable concept prerequisite as a hard problem', async () => {
    const bank = await loadBank(BANK)
    const concept = bank.conceptsById.get('storage.lvm-abstraction-stack')
    if (!concept) throw new Error('fixture missing')
    concept.prerequisites = ['storage.nope']

    const report = checkCoverage(bank)
    expect(report.problems.join('\n')).toMatch(
      /storage\.lvm-abstraction-stack lists unknown prerequisite: storage\.nope/,
    )
  })

  it('treats a prerequisite cycle as a hard problem, not a gap', async () => {
    // A cycle makes `prerequisitesOf` claim a card must be studied before
    // itself, so it is content lying about itself in the same way a dangling
    // reference is: `problems`, which fails `coverage --strict` and
    // `refuseToServe`, not a gap list that gets logged and served anyway.
    const bank = await loadBank(BANK)
    const a = bank.conceptsById.get('storage.lvm-abstraction-stack')
    const b = bank.conceptsById.get('storage.orphan-concept')
    if (!a || !b) throw new Error('fixture missing')
    a.prerequisites = ['storage.orphan-concept']
    b.prerequisites = ['storage.lvm-abstraction-stack']

    const report = checkCoverage(bank)
    expect(report.problems.join('\n')).toMatch(/prerequisite cycle: /)
  })

  it('lists objectives a task exercises that no concept card teaches toward', async () => {
    // The other half of the safety net: uncoveredObjectives catches material
    // that is never practised, this catches material that is practised and
    // never explained. Both fixture cards point at storage.lvm.resize, so
    // users.local.create is drilled by a task with nothing to read.
    const report = checkCoverage(await loadBank(BANK))
    expect(report.objectivesWithoutConcept).toEqual(['users.local.create'])
  })

  it('counts an instrumental task as exercising an objective that then needs a card', async () => {
    // Deliberately looser than coveredObjectives. An instrumental task cannot
    // claim coverage (spec 6.4) but it does put the objective in front of the
    // student, so it is exactly the population that still needs an explanation.
    const bank = await loadBank(BANK)
    const task = bank.tasksById.get('users/001-create-account')
    if (!task) throw new Error('fixture missing')
    task.scope = 'instrumental'

    const report = checkCoverage(bank)
    expect(report.objectivesWithoutConcept).toEqual(['users.local.create'])
  })

  it('lists objectives no task exercises and no card teaches', async () => {
    // Spec 6.2: never taught and never demonstrated. autofs has neither.
    const report = checkCoverage(await loadBank(BANK))
    expect(report.untouchedObjectives).toEqual(['autofs.maps.configure'])
  })

  it('stops calling an objective untouched once a card teaches toward it, while it stays uncovered', async () => {
    // Distinguishes the two questions: a card removes "never taught", only an
    // exam-objective task removes "not covered". Collapsing them would let a
    // card silently retire an objective nothing practises.
    const bank = await loadBank(BANK)
    const concept = bank.conceptsById.get('storage.orphan-concept')
    if (!concept) throw new Error('fixture missing')
    concept.objectives = ['autofs.maps.configure']

    const report = checkCoverage(bank)
    expect(report.untouchedObjectives).toEqual([])
    expect(report.uncoveredObjectives).toEqual(['autofs.maps.configure'])
  })

  it('lists cards nothing a task requires can reach, even transitively', async () => {
    const report = checkCoverage(await loadBank(BANK))
    expect(report.unreachableConcepts).toEqual(['storage.orphan-concept'])
  })

  it('treats a card reachable only as a prerequisite as deliverable, unlike untaughtConcepts', async () => {
    // The reason unreachableConcepts exists alongside untaughtConcepts. No task
    // names the orphan card, so it stays untaught — but a task-required card now
    // needs it first, so the student does get it, and it must not be reported as
    // content that can never be delivered.
    const bank = await loadBank(BANK)
    const concept = bank.conceptsById.get('storage.lvm-abstraction-stack')
    if (!concept) throw new Error('fixture missing')
    concept.prerequisites = ['storage.orphan-concept']

    const report = checkCoverage(bank)
    expect(report.problems).toEqual([])
    expect(report.untaughtConcepts).toEqual(['storage.orphan-concept'])
    expect(report.unreachableConcepts).toEqual([])
  })

  it('excludes instrumental tasks from objective coverage', async () => {
    // Chapter 21 Apache teaches SELinux and firewalld through a non-objective
    // service. It must not be able to claim coverage of an objective on its own.
    const bank = await loadBank(BANK)
    const task = bank.tasksById.get('storage/014-grow-var')
    if (!task) throw new Error('fixture missing')
    task.scope = 'instrumental'

    const report = checkCoverage(bank)
    expect(report.uncoveredObjectives.sort()).toEqual([
      'autofs.maps.configure',
      'storage.lvm.resize',
    ])
  })
})

describe('loadBank duplicate detection', () => {
  it('rejects two tasks declaring the same id, naming both files', async () => {
    const err = await loadBank(
      new URL('../fixtures/bank-dupe', import.meta.url).pathname,
    ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ContentError)
    const joined = (err as ContentError).problems.join('\n')
    expect(joined).toMatch(/duplicate task id: users\/001-create-account/)
    // Both collision partners must be named, not just the second-loaded one,
    // so an author can find the other half of the collision without
    // grepping the whole bank.
    expect(joined).toMatch(/tasks\/a\/001-x/)
    expect(joined).toMatch(/tasks\/b\/001-x/)
  })

  it('rejects two concepts declaring the same id, naming both files', async () => {
    const err = await loadBank(
      new URL('../fixtures/bank-dupe-concepts', import.meta.url).pathname,
    ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ContentError)
    const joined = (err as ContentError).problems.join('\n')
    expect(joined).toMatch(/duplicate concept id: storage\.lvm-abstraction-stack/)
    expect(joined).toMatch(/concepts\/a\/dup\.md/)
    expect(joined).toMatch(/concepts\/b\/dup\.md/)
  })
})

describe('loadBank aggregates loader failures (deviation 1)', () => {
  it('reports both malformed task files in a single ContentError', async () => {
    const err = await loadBank(
      new URL('../fixtures/bank-multi-malformed', import.meta.url).pathname,
    ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ContentError)
    const joined = (err as ContentError).problems.join('\n')
    // area-a's task.yaml has an invalid id; area-b's is missing objectives.
    // Both must be attributable in the same aggregate error.
    expect(joined).toMatch(/area-a.*task\.yaml/)
    expect(joined).toMatch(/area-b.*task\.yaml/)
    expect(joined).toMatch(/id must look like/)
    expect(joined).toMatch(/objectives must list at least one objective id/)
  })

  it('wraps a malformed objectives.yaml as a ContentError, not a raw YAMLException', async () => {
    const err = await loadBank(
      new URL('../fixtures/bank-bad-objectives', import.meta.url).pathname,
    ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ContentError)
    expect(err).not.toMatchObject({ name: 'YAMLException' })
    expect((err as ContentError).problems.join('\n')).toMatch(/objectives\.yaml/)
  })

  it('reports both malformed concept files in a single ContentError', async () => {
    const err = await loadBank(
      new URL('../fixtures/bank-multi-malformed-concepts', import.meta.url).pathname,
    ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ContentError)
    const joined = (err as ContentError).problems.join('\n')
    // bad-id.md's id is not dotted lowercase; short-body.md's body is under
    // the minimum length. Both must be attributable in the same aggregate.
    expect(joined).toMatch(/bad-id\.md/)
    expect(joined).toMatch(/short-body\.md/)
    expect(joined).toMatch(/id must be dotted lowercase/)
    expect(joined).toMatch(/body must be at least \d+ characters/)
  })

  it('does not let an objectives failure mask a simultaneous task failure', async () => {
    // Reinstating fail-fast after the objectives load (throwing immediately
    // instead of collecting the rejection into `problems`) would make this
    // pass with only the objectives problem reported and the task file
    // never even attempted — exactly the regression deviation 1 exists to
    // prevent. See the loadBank aggregates loader failures tests above.
    const err = await loadBank(
      new URL('../fixtures/bank-objectives-and-task-malformed', import.meta.url).pathname,
    ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ContentError)
    const joined = (err as ContentError).problems.join('\n')
    expect(joined).toMatch(/objectives\.yaml/)
    expect(joined).toMatch(/tasks\/x\/001-y/)
    expect(joined).toMatch(/prompt must be a non-empty string/)
  })
})

describe('loadBank reports a missing content directory (deviation 2)', () => {
  it('treats a missing tasks/ directory as a problem, not an empty bank', async () => {
    const result = await loadBank(
      new URL('../fixtures/bank-missing-tasks', import.meta.url).pathname,
    ).then(
      (bank) => ({ ok: true as const, bank }),
      (error: unknown) => ({ ok: false as const, error }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected loadBank to reject, not resolve')
    expect(result.error).toBeInstanceOf(ContentError)
    // Assert the actual message, not just that "tasks" appears somewhere —
    // the fixture root itself is named "bank-missing-tasks", so a loose
    // /tasks/ match would pass even if this were reporting a problem with
    // the concepts/ directory instead.
    expect((result.error as ContentError).problems.join('\n')).toMatch(
      /cannot read directory .*[/\\]tasks: .*ENOENT/,
    )
  })
})
