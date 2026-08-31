### Task 6: Objectives taxonomy loader

**Files:**
- Create: `src/engine/content/objectives.ts`
- Test: `test/content/objectives.test.ts`, fixture `test/fixtures/objectives-good.yaml`

**Interfaces:**
- Consumes: `ContentError`.
- Produces:
  - `interface Objective { id: string; text: string; chapters: number[] }`
  - `interface ObjectiveSet { version: string; source: string; objectives: Objective[]; byId: Map<string, Objective> }`
  - `function parseObjectives(raw: unknown, where: string): ObjectiveSet`
  - `function loadObjectives(path: string): Promise<ObjectiveSet>`

- [ ] **Step 1: Write the failing test**

Fixture `test/fixtures/objectives-good.yaml`:

```yaml
version: rhel9
source: "RHCSA 9 Cert Guide objective mapping table, p.38"
objectives:
  - id: storage.lvm.resize
    text: Extend existing logical volumes
    chapters: [15]
  - id: storage.fs.xfs
    text: Create, mount, unmount and use XFS filesystems
    chapters: [14, 15]
  - id: users.local.create
    text: Create, delete and modify local user accounts
    chapters: [6]
```

`test/content/objectives.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/content/objectives.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/content/objectives.ts'`.

- [ ] **Step 3: Write the implementation**

`src/engine/content/objectives.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { load } from 'js-yaml'
import { ContentError } from './errors.ts'

export interface Objective {
  id: string
  text: string
  chapters: number[]
}

export interface ObjectiveSet {
  version: string
  source: string
  objectives: Objective[]
  byId: Map<string, Objective>
}

const OBJECTIVE_ID_RE = /^[a-z0-9]+(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function parseObjectives(raw: unknown, where: string): ObjectiveSet {
  const problems: string[] = []

  if (!isRecord(raw)) throw new ContentError(where, ['file must contain a YAML mapping'])

  const version = typeof raw.version === 'string' && raw.version !== '' ? raw.version : ''
  if (!version) problems.push('version must be a non-empty string, e.g. rhel9')

  const source = typeof raw.source === 'string' && raw.source !== '' ? raw.source : ''
  if (!source) problems.push('source must cite where the taxonomy was transcribed from')

  const list = Array.isArray(raw.objectives) ? raw.objectives : []
  if (list.length === 0) problems.push('objectives must list at least one objective')

  const objectives: Objective[] = []
  const seen = new Set<string>()

  for (const [i, entry] of list.entries()) {
    if (!isRecord(entry)) {
      problems.push(`objectives[${i}] must be a mapping`)
      continue
    }

    const id = typeof entry.id === 'string' && OBJECTIVE_ID_RE.test(entry.id) ? entry.id : ''
    if (!id) {
      problems.push(`objectives[${i}].id must be dotted lowercase, e.g. storage.lvm.resize`)
    } else if (seen.has(id)) {
      problems.push(`duplicate objective id: ${id}`)
    }
    if (id) seen.add(id)

    const text = typeof entry.text === 'string' && entry.text.trim() !== '' ? entry.text : ''
    if (!text) problems.push(`objectives[${i}].text must be non-empty`)

    const rawChapters = Array.isArray(entry.chapters) ? entry.chapters : []
    const bad = rawChapters.some(
      (c) => typeof c !== 'number' || !Number.isInteger(c) || c < 1 || c > 28,
    )
    if (rawChapters.length === 0 || bad) {
      problems.push(`objectives[${i}].chapters must be integers 1-28, at least one`)
    }

    objectives.push({ id, text, chapters: bad ? [] : (rawChapters as number[]) })
  }

  if (problems.length > 0) throw new ContentError(where, problems)

  return {
    version,
    source,
    objectives,
    byId: new Map(objectives.map((o) => [o.id, o])),
  }
}

export async function loadObjectives(path: string): Promise<ObjectiveSet> {
  return parseObjectives(load(await readFile(path, 'utf8')), path)
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
git add src/engine/content/objectives.ts test/content/objectives.test.ts test/fixtures/objectives-good.yaml && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(content): add objectives taxonomy loader

A required source field forces every taxonomy to cite where it was
transcribed from, since these tables are images in both editions and must be
read visually rather than extracted."
```

---

