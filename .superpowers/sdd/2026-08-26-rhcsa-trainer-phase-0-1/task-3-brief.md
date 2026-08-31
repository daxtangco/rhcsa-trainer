### Task 3: `TaskSpec` loader

**Files:**
- Create: `src/engine/content/task.ts`
- Test: `test/content/task.test.ts`, plus fixtures under `test/fixtures/tasks/`

**Interfaces:**
- Consumes: `ContentError` from `src/engine/content/errors.ts`.
- Produces:
  - `type TaskScope = 'exam-objective' | 'instrumental'`
  - `type TaskWeight = 'low' | 'medium' | 'high'`
  - `interface TaskSpec` with fields `id, title, chapter, scope, rhel, objectives, requiresConcepts, difficulty, timeBudget, weight, editions, rebootCheck, requiresDisks, claims, transport, prompt, dir`
  - `function parseTaskSpec(raw: unknown, dir: string): TaskSpec` (throws `ContentError`)
  - `function loadTask(dir: string): Promise<TaskSpec>`

- [ ] **Step 1: Write the failing test**

Create fixture `test/fixtures/tasks/good/task.yaml`:

```yaml
id: storage/014-shrink-home-grow-var
title: Reclaim space from /home and give it to /var
chapter: 15
scope: exam-objective
rhel: 9
objectives: [storage.lvm.resize, storage.fs.xfs]
requires_concepts:
  - storage.lvm-abstraction-stack
  - storage.why-xfs-cannot-shrink
difficulty: 3
time_budget: 480
weight: high
editions: [r9, r10]
reboot_check: true
requires_disks: 0
claims: [vg:rhel, lv:var]
transport: ssh
prompt: |
  /var is nearly full while /home is mostly empty. Grow the var
  logical volume to at least 6 GB. All filesystems must mount
  correctly on boot.
```

Create fixture `test/fixtures/tasks/bad/task.yaml`:

```yaml
id: Storage/BAD ID
title: ""
chapter: 0
scope: extra-credit
rhel: 9
objectives: []
difficulty: 9
time_budget: -1
weight: enormous
editions: [r9]
reboot_check: yes-please
requires_disks: 4
claims: []
transport: telnet
prompt: ""
```

`test/content/task.test.ts`:

```ts
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
```

Also create `test/fixtures/tasks/minimal/task.yaml`:

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

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/content/task.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/content/task.ts'`.

- [ ] **Step 3: Write the implementation**

`src/engine/content/task.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { ContentError } from './errors.ts'

export type TaskScope = 'exam-objective' | 'instrumental'
export type TaskWeight = 'low' | 'medium' | 'high'
export type TaskTransport = 'ssh' | 'vmrun'

const SCOPES: readonly string[] = ['exam-objective', 'instrumental']
const WEIGHTS: readonly string[] = ['low', 'medium', 'high']
const TRANSPORTS: readonly string[] = ['ssh', 'vmrun']

/**
 * Spec section 4.1's VM design has three spare disk slots; more is
 * unsatisfiable. Phase 1 provisions none of them (see Task 19), so every
 * Phase 1 task declares 0 — this is the schema's bound, not a promise that
 * three disks are attached.
 */
const MAX_SPARE_DISKS = 3

export interface TaskSpec {
  id: string
  title: string
  chapter: number
  scope: TaskScope
  rhel: number
  objectives: string[]
  requiresConcepts: string[]
  difficulty: number
  timeBudget: number
  weight: TaskWeight
  editions: string[]
  rebootCheck: boolean
  requiresDisks: number
  claims: string[]
  transport: TaskTransport
  prompt: string
  dir: string
}

const TASK_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[0-9]{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function stringArray(v: unknown, field: string, problems: string[]): string[] {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    problems.push(`${field} must be a list of strings`)
    return []
  }
  return v as string[]
}

function intInRange(
  v: unknown,
  field: string,
  min: number,
  max: number,
  problems: string[],
): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    problems.push(`${field} must be an integer ${min}-${max}`)
    return min
  }
  return v
}

export function parseTaskSpec(raw: unknown, dir: string): TaskSpec {
  const problems: string[] = []

  if (!isRecord(raw)) {
    throw new ContentError(join(dir, 'task.yaml'), ['file must contain a YAML mapping'])
  }

  const id = typeof raw.id === 'string' && TASK_ID_RE.test(raw.id) ? raw.id : ''
  if (!id) problems.push('id must look like "<area>/<nnn>-<slug>", lowercase')

  const title = typeof raw.title === 'string' && raw.title.trim() !== '' ? raw.title : ''
  if (!title) problems.push('title must be a non-empty string')

  const chapter = intInRange(raw.chapter, 'chapter', 1, 28, problems)
  const rhel = intInRange(raw.rhel, 'rhel', 9, 10, problems)
  const difficulty = intInRange(raw.difficulty, 'difficulty', 1, 5, problems)
  const timeBudget = intInRange(raw.time_budget, 'time_budget', 30, 3600, problems)
  const requiresDisks = intInRange(raw.requires_disks ?? 0, 'requires_disks', 0, MAX_SPARE_DISKS, problems)

  const scope = SCOPES.includes(raw.scope as string) ? (raw.scope as TaskScope) : 'exam-objective'
  if (!SCOPES.includes(raw.scope as string)) {
    problems.push(`scope must be one of: ${SCOPES.join(', ')}`)
  }

  const weight = WEIGHTS.includes(raw.weight as string) ? (raw.weight as TaskWeight) : 'medium'
  if (!WEIGHTS.includes(raw.weight as string)) {
    problems.push(`weight must be one of: ${WEIGHTS.join(', ')}`)
  }

  const rawTransport = raw.transport ?? 'ssh'
  const transport = TRANSPORTS.includes(rawTransport as string)
    ? (rawTransport as TaskTransport)
    : 'ssh'
  if (!TRANSPORTS.includes(rawTransport as string)) {
    problems.push(`transport must be one of: ${TRANSPORTS.join(', ')}`)
  }

  const rawReboot = raw.reboot_check ?? false
  if (typeof rawReboot !== 'boolean') {
    problems.push('reboot_check must be a boolean')
  }
  const rebootCheck = typeof rawReboot === 'boolean' ? rawReboot : false

  const objectives = stringArray(raw.objectives, 'objectives', problems)
  if (objectives.length === 0) {
    problems.push('objectives must list at least one objective id')
  }

  const prompt = typeof raw.prompt === 'string' && raw.prompt.trim() !== '' ? raw.prompt : ''
  if (!prompt) problems.push('prompt must be a non-empty string')

  const spec: TaskSpec = {
    id,
    title,
    chapter,
    scope,
    rhel,
    objectives,
    requiresConcepts: stringArray(raw.requires_concepts, 'requires_concepts', problems),
    difficulty,
    timeBudget,
    weight,
    editions: stringArray(raw.editions, 'editions', problems),
    rebootCheck,
    requiresDisks,
    claims: stringArray(raw.claims, 'claims', problems),
    transport,
    prompt,
    dir,
  }

  if (problems.length > 0) throw new ContentError(join(dir, 'task.yaml'), problems)
  return spec
}

export async function loadTask(dir: string): Promise<TaskSpec> {
  const text = await readFile(join(dir, 'task.yaml'), 'utf8')
  return parseTaskSpec(load(text), dir)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 4 new tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/engine/content/task.ts test/content test/fixtures && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(content): add TaskSpec loader with aggregating validation

requires_disks is capped at 3 because spec section 4.1's VM design has three
spare disk slots, so a higher value is unsatisfiable rather than merely
unusual. Phase 1 attaches none of them (Task 19), and every Phase 1 task
declares 0."
```

---

