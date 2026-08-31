### Task 7: Content bank loader and coverage report

**Files:**
- Create: `src/engine/content/bank.ts`
- Test: `test/content/bank.test.ts`, fixture tree under `test/fixtures/bank/`

**Interfaces:**
- Consumes: `loadTask`/`TaskSpec` (T3), `loadConcept`/`ConceptSpec` (T4), `loadObjectives`/`ObjectiveSet` (T6), `ContentError` (T2).
- Produces:
  - `interface Bank { root, objectives, tasks, concepts, tasksById, conceptsById }`
  - `interface CoverageReport { problems: string[]; untaughtConcepts: string[]; uncoveredObjectives: string[] }`
  - `function loadBank(root: string): Promise<Bank>`
  - `function checkCoverage(bank: Bank): CoverageReport`

**Design note — why coverage gaps are not errors yet.** Spec §8 lists "every objective has at least one task" as an assertion. Taken literally in Phase 1 that makes `validate` fail permanently, because Phase 1 authors five tasks against a taxonomy of dozens of objectives. So `problems` holds only *unresolvable references* (a genuine authoring bug), while gaps are returned as counted lists for the Dashboard to surface. Task 12 wires a `--strict` flag that promotes gaps to failures, for use once the bank is complete.

- [ ] **Step 1: Create the fixture tree**

```bash
cd /home/daxtangco/rhcsa-trainer
mkdir -p test/fixtures/bank/tasks/storage/014-grow-var \
         test/fixtures/bank/tasks/users/001-create-account \
         test/fixtures/bank/concepts/storage
```

`test/fixtures/bank/objectives.yaml`:

```yaml
version: rhel9
source: "test fixture"
objectives:
  - id: storage.lvm.resize
    text: Extend existing logical volumes
    chapters: [15]
  - id: users.local.create
    text: Create, delete and modify local user accounts
    chapters: [6]
  - id: autofs.maps.configure
    text: Configure autofs
    chapters: [16]
```

`test/fixtures/bank/tasks/storage/014-grow-var/task.yaml`:

```yaml
id: storage/014-grow-var
title: Grow the var logical volume
chapter: 15
scope: exam-objective
rhel: 9
objectives: [storage.lvm.resize]
requires_concepts: [storage.lvm-abstraction-stack]
difficulty: 3
time_budget: 480
weight: high
prompt: |
  Grow the var logical volume to at least 6 GB.
```

`test/fixtures/bank/tasks/users/001-create-account/task.yaml`:

```yaml
id: users/001-create-account
title: Create a user account
chapter: 6
scope: exam-objective
rhel: 9
objectives: [users.local.create]
difficulty: 1
time_budget: 120
weight: medium
prompt: |
  Create a user named alice.
```

`test/fixtures/bank/concepts/storage/lvm-abstraction-stack.md`:

```markdown
---
id: storage.lvm-abstraction-stack
title: Physical volumes, volume groups, logical volumes
rhel: 9
objectives: [storage.lvm.resize]
---
LVM inserts two layers between a disk and a filesystem: a physical volume is a
disk handed to LVM, a volume group pools physical volumes, and a logical volume
is carved out of that pool. Growing a filesystem is therefore a two-step job.
```

`test/fixtures/bank/concepts/storage/orphan.md`:

```markdown
---
id: storage.orphan-concept
title: A concept no task requires
rhel: 9
objectives: [storage.lvm.resize]
---
This card exists to prove that checkCoverage notices concepts which no task
ever pulls in, because an unreferenced card is one the user will never be shown
and therefore silently fails the promise to replace the book.
```

- [ ] **Step 2: Write the failing test**

`test/content/bank.test.ts`:

```ts
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
  it('rejects two tasks declaring the same id', async () => {
    const err = await loadBank(
      new URL('../fixtures/bank-dupe', import.meta.url).pathname,
    ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ContentError)
    expect((err as ContentError).problems.join('\n')).toMatch(/duplicate task id/)
  })
})
```

Create the duplicate fixture:

```bash
cd /home/daxtangco/rhcsa-trainer
mkdir -p test/fixtures/bank-dupe/tasks/a/001-x test/fixtures/bank-dupe/tasks/b/001-x \
         test/fixtures/bank-dupe/concepts
cp test/fixtures/bank/objectives.yaml test/fixtures/bank-dupe/objectives.yaml
for d in a b; do
  cat > "test/fixtures/bank-dupe/tasks/$d/001-x/task.yaml" <<'YAML'
id: users/001-create-account
title: Duplicated on purpose
chapter: 6
scope: exam-objective
rhel: 9
objectives: [users.local.create]
difficulty: 1
time_budget: 120
weight: medium
prompt: |
  Create a user named alice.
YAML
done
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/content/bank.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/content/bank.ts'`.

- [ ] **Step 4: Write the implementation**

`src/engine/content/bank.ts`:

```ts
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ContentError } from './errors.ts'
import { loadConcept, type ConceptSpec } from './concept.ts'
import { loadObjectives, type ObjectiveSet } from './objectives.ts'
import { loadTask, type TaskSpec } from './task.ts'

export interface Bank {
  root: string
  objectives: ObjectiveSet
  tasks: TaskSpec[]
  concepts: ConceptSpec[]
  tasksById: Map<string, TaskSpec>
  conceptsById: Map<string, ConceptSpec>
}

export interface CoverageReport {
  /** Authoring bugs: a reference that does not resolve. Fails `validate`. */
  problems: string[]
  /** Concepts no task pulls in, so the user can never be shown them. */
  untaughtConcepts: string[]
  /** Objectives with no exam-objective task. Expected to be non-empty until the bank is complete. */
  uncoveredObjectives: string[]
}

async function findFiles(root: string, filename: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => [])
  return entries
    .filter((e) => e.isFile() && e.name === filename)
    .map((e) => join(e.parentPath, e.name))
}

async function findMarkdown(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => [])
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => join(e.parentPath, e.name))
    .sort()
}

export async function loadBank(root: string): Promise<Bank> {
  const objectives = await loadObjectives(join(root, 'objectives.yaml'))

  const taskFiles = (await findFiles(join(root, 'tasks'), 'task.yaml')).sort()
  const tasks = await Promise.all(taskFiles.map((f) => loadTask(dirname(f))))

  const conceptFiles = await findMarkdown(join(root, 'concepts'))
  const concepts = await Promise.all(conceptFiles.map((f) => loadConcept(f)))

  const problems: string[] = []
  const tasksById = new Map<string, TaskSpec>()
  for (const t of tasks) {
    if (tasksById.has(t.id)) problems.push(`duplicate task id: ${t.id} (${t.dir})`)
    tasksById.set(t.id, t)
  }

  const conceptsById = new Map<string, ConceptSpec>()
  for (const c of concepts) {
    if (conceptsById.has(c.id)) problems.push(`duplicate concept id: ${c.id} (${c.path})`)
    conceptsById.set(c.id, c)
  }

  if (problems.length > 0) throw new ContentError(root, problems)

  return { root, objectives, tasks, concepts, tasksById, conceptsById }
}

export function checkCoverage(bank: Bank): CoverageReport {
  const problems: string[] = []
  const referencedConcepts = new Set<string>()
  const coveredObjectives = new Set<string>()

  for (const task of bank.tasks) {
    for (const cid of task.requiresConcepts) {
      referencedConcepts.add(cid)
      if (!bank.conceptsById.has(cid)) {
        problems.push(`${task.id} requires unknown concept: ${cid}`)
      }
    }
    for (const oid of task.objectives) {
      if (!bank.objectives.byId.has(oid)) {
        problems.push(`${task.id} maps to unknown objective: ${oid}`)
        continue
      }
      // Instrumental tasks teach an objective through a non-objective service
      // (spec section 6.4), so they must not be able to claim coverage alone.
      if (task.scope === 'exam-objective') coveredObjectives.add(oid)
    }
  }

  for (const concept of bank.concepts) {
    for (const pid of concept.prerequisites) {
      if (!bank.conceptsById.has(pid)) {
        problems.push(`${concept.id} lists unknown prerequisite: ${pid}`)
      }
    }
  }

  const untaughtConcepts = bank.concepts
    .map((c) => c.id)
    .filter((id) => !referencedConcepts.has(id))
    .sort()

  const uncoveredObjectives = bank.objectives.objectives
    .map((o) => o.id)
    .filter((id) => !coveredObjectives.has(id))
    .sort()

  return { problems, untaughtConcepts, uncoveredObjectives }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 9 new tests PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/engine/content/bank.ts test/content/bank.test.ts test/fixtures/bank test/fixtures/bank-dupe && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(content): load the bank and report coverage

Unresolvable references are hard problems; coverage gaps are counted lists.
Making gaps errors would fail validate permanently in Phase 1, when five tasks
exist against a taxonomy of dozens. Instrumental tasks cannot claim objective
coverage on their own, per spec section 6.4."
```

---

