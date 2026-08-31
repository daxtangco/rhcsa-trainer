### Task 4: `ConceptSpec` loader

**Files:**
- Create: `src/engine/content/concept.ts`
- Test: `test/content/concept.test.ts`, fixtures under `test/fixtures/concepts/`

**Interfaces:**
- Consumes: `ContentError`.
- Produces:
  - `interface ConceptSpec { id, title, rhel, objectives, sources, prerequisites, body, path }`
  - `function parseConcept(text: string, path: string): ConceptSpec`
  - `function loadConcept(path: string): Promise<ConceptSpec>`

- [ ] **Step 1: Write the failing test**

Fixture `test/fixtures/concepts/good.md`:

```markdown
---
id: storage.lvm-abstraction-stack
title: Physical volumes, volume groups, logical volumes
rhel: 9
objectives: [storage.lvm.create, storage.lvm.resize]
sources: [r9:ch15, r10:ch15]
prerequisites: [storage.partitions]
---
LVM inserts two layers between a disk and a filesystem. A **physical volume**
is a whole disk or partition handed over to LVM. A **volume group** pools one
or more physical volumes into a single allocation space. A **logical volume**
is carved out of that pool and is what you actually format and mount.

The point of the pool is that a logical volume need not be contiguous, and
need not live on one disk. That is why growing a filesystem is normally a
two-step job: grow the logical volume, then grow the filesystem inside it.
```

Fixture `test/fixtures/concepts/bad.md`:

```markdown
---
id: Storage.Bad Id
rhel: 11
objectives: "not-a-list"
---
```

`test/content/concept.test.ts`:

```ts
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
})
```

Fixture `test/fixtures/concepts/minimal.md`:

```markdown
---
id: systemd.enabled-versus-started
title: Enabled and started are different things
rhel: 9
objectives: [systemd.services.manage]
---
`systemctl start` runs a unit now. `systemctl enable` creates the symlink that
makes it run at boot. Neither implies the other, so a service can be running
and still be absent after a reboot — which is precisely what the exam checks,
because the exam reboots before grading.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/content/concept.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/content/concept.ts'`.

- [ ] **Step 3: Write the implementation**

`src/engine/content/concept.ts`:

```ts
import { readFile } from 'node:fs/promises'
import matter from 'gray-matter'
import { ContentError } from './errors.ts'

export interface ConceptSpec {
  id: string
  title: string
  rhel: number
  objectives: string[]
  sources: string[]
  prerequisites: string[]
  body: string
  path: string
}

/** Dotted lowercase, e.g. storage.lvm-abstraction-stack */
const CONCEPT_ID_RE = /^[a-z0-9]+(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/

/**
 * A card shorter than this is a stub, not teaching. The spec budgets 200-300
 * words per card; 120 characters is a floor that catches empties and
 * accidental truncation without policing style.
 */
const MIN_BODY_CHARS = 120

function stringArray(v: unknown, field: string, problems: string[]): string[] {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    problems.push(`${field} must be a list of strings`)
    return []
  }
  return v as string[]
}

export function parseConcept(text: string, path: string): ConceptSpec {
  const problems: string[] = []
  const parsed = matter(text)
  const fm = parsed.data as Record<string, unknown>

  const id = typeof fm.id === 'string' && CONCEPT_ID_RE.test(fm.id) ? fm.id : ''
  if (!id) problems.push('id must be dotted lowercase, e.g. storage.lvm-abstraction-stack')

  const title = typeof fm.title === 'string' && fm.title.trim() !== '' ? fm.title : ''
  if (!title) problems.push('title must be a non-empty string')

  const rhel = typeof fm.rhel === 'number' && (fm.rhel === 9 || fm.rhel === 10) ? fm.rhel : 9
  if (rhel !== fm.rhel) problems.push('rhel must be an integer 9-10')

  const objectives = stringArray(fm.objectives, 'objectives', problems)
  if (objectives.length === 0 && Array.isArray(fm.objectives)) {
    problems.push('objectives must list at least one objective id')
  }

  const body = parsed.content.trim()
  if (body.length < MIN_BODY_CHARS) {
    problems.push(`body must be at least ${MIN_BODY_CHARS} characters of prose`)
  }

  const spec: ConceptSpec = {
    id,
    title,
    rhel,
    objectives,
    sources: stringArray(fm.sources, 'sources', problems),
    prerequisites: stringArray(fm.prerequisites, 'prerequisites', problems),
    body,
    path,
  }

  if (problems.length > 0) throw new ContentError(path, problems)
  return spec
}

export async function loadConcept(path: string): Promise<ConceptSpec> {
  return parseConcept(await readFile(path, 'utf8'), path)
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
git add src/engine/content/concept.ts test/content/concept.test.ts test/fixtures/concepts && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(content): add ConceptSpec loader with a body-length floor

The floor exists because an empty concept card is the one failure mode that
silently breaks the app's promise to replace the book (risk R7)."
```

---

