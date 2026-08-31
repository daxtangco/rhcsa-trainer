### Task 14: Corpus extraction script

Turns both PDFs into structured raw input for authoring, and computes the cross-edition weight signal (spec §14.4 use 1).

**Files:**
- Create: `scripts/extract-corpus.ts`
- Test: `test/corpus/extract.test.ts`

**Interfaces:**
- Consumes: nothing from the engine — this is a standalone script.
- Produces:
  - `interface CorpusItem { id: string; kind: 'lab' | 'exercise'; chapter: number; edition: string; text: string }`
  - `function findItems(fullText: string, edition: string): CorpusItem[]`
  - `function weightSignal(items: CorpusItem[]): Record<string, string[]>` — item id → editions containing it
  - CLI entry writing `corpus/<edition>/labs.json`, `corpus/<edition>/exercises.json`, `corpus/signal.json`

- [ ] **Step 1: Write the failing test**

`test/corpus/extract.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { findItems, weightSignal } from '../../scripts/extract-corpus.ts'

const SAMPLE = [
  'Chapter 15. Managing Advanced Storage',
  'some prose about volume groups',
  '',
  'Exercise 15-1 Creating a volume group',
  '1. Open a root shell.',
  '2. Run vgcreate vgdata /dev/sdb.',
  '',
  'Exercise 15-2 Extending a logical volume',
  '1. Run lvextend -L 6G /dev/vgdata/lvdata.',
  '',
  'Lab 15.1  Managing logical volumes',
  'Create a volume group and a 6 GB logical volume.',
  '',
  'Chapter 16. Managing Autofs',
  'Exercise 16-1 Configuring autofs',
  '1. Install autofs.',
].join('\n')

describe('findItems', () => {
  it('finds exercises with their chapter and body', () => {
    const items = findItems(SAMPLE, 'r9')
    const ex = items.filter((i) => i.kind === 'exercise')

    expect(ex.map((i) => i.id)).toEqual(['Exercise 15-1', 'Exercise 15-2', 'Exercise 16-1'])
    expect(ex[0]?.chapter).toBe(15)
    expect(ex[0]?.text).toMatch(/vgcreate vgdata/)
    expect(ex[2]?.chapter).toBe(16)
    expect(ex[0]?.edition).toBe('r9')
  })

  it('finds labs and tolerates the double space the layout extraction leaves', () => {
    const items = findItems(SAMPLE, 'r9')
    const labs = items.filter((i) => i.kind === 'lab')

    expect(labs.map((i) => i.id)).toEqual(['Lab 15.1'])
    expect(labs[0]?.chapter).toBe(15)
    expect(labs[0]?.text).toMatch(/6 GB logical volume/)
  })

  it('stops an item body at the next heading rather than swallowing the chapter', () => {
    const items = findItems(SAMPLE, 'r9')
    const first = items.find((i) => i.id === 'Exercise 15-1')
    expect(first?.text).not.toMatch(/Extending a logical volume/)
  })

  it('deduplicates ids that appear in both a table of contents and the body', () => {
    // Every lab and exercise id appears at least twice: once in the contents
    // listing and once at the real heading. The longest body wins, because the
    // contents entry is a single line.
    const withToc = ['Exercise 15-1 Creating a volume group', '', SAMPLE].join('\n')
    const ids = findItems(withToc, 'r9')
      .filter((i) => i.kind === 'exercise')
      .map((i) => i.id)
    expect(ids).toEqual(['Exercise 15-1', 'Exercise 15-2', 'Exercise 16-1'])
  })
})

describe('weightSignal', () => {
  it('records which editions contain each item', () => {
    const items = [
      ...findItems(SAMPLE, 'r9'),
      ...findItems('Chapter 15. x\nExercise 15-1 Creating a volume group\n1. Do it.', 'r10'),
    ]
    const signal = weightSignal(items)

    // Present in both editions: durable core RHCSA material.
    expect(signal['Exercise 15-1']).toEqual(['r10', 'r9'])
    // Present in one: version-specific.
    expect(signal['Lab 15.1']).toEqual(['r9'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/corpus/extract.test.ts`
Expected: FAIL — `Cannot find module '../../scripts/extract-corpus.ts'`.

- [ ] **Step 3: Write the implementation**

`scripts/extract-corpus.ts`:

```ts
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface CorpusItem {
  id: string
  kind: 'lab' | 'exercise'
  chapter: number
  edition: string
  text: string
}

/** `Lab 15.1` / `Lab  15.1` — layout extraction leaves variable spacing. */
const LAB_RE = /^\s*(Lab) +(\d+)\.(\d+)\b/
/** `Exercise 15-1` */
const EX_RE = /^\s*(Exercise) +(\d+)-(\d+)\b/
/** RHCSA 9 uses `Chapter 15 `, RHCSA 10 uses `Chapter 15.` */
const CHAPTER_RE = /^\s*Chapter +(\d+)[.\s]/

/** Cap a body so a missed heading cannot swallow half a chapter. */
const MAX_BODY_LINES = 120

function heading(line: string): { kind: 'lab' | 'exercise'; id: string; chapter: number } | undefined {
  const lab = LAB_RE.exec(line)
  if (lab) {
    return { kind: 'lab', id: `Lab ${lab[2]}.${lab[3]}`, chapter: Number(lab[2]) }
  }
  const ex = EX_RE.exec(line)
  if (ex) {
    return { kind: 'exercise', id: `Exercise ${ex[2]}-${ex[3]}`, chapter: Number(ex[2]) }
  }
  return undefined
}

/**
 * Slice labs and exercises out of `pdftotext -layout` output.
 *
 * Every id appears at least twice — once in the table of contents, once at the
 * real heading — so the longest body wins. A contents entry is one line and
 * always loses.
 */
export function findItems(fullText: string, edition: string): CorpusItem[] {
  const lines = fullText.split('\n')

  const starts: Array<{ index: number; kind: 'lab' | 'exercise'; id: string; chapter: number }> = []
  for (const [index, line] of lines.entries()) {
    const h = heading(line)
    if (h) starts.push({ index, ...h })
  }

  const best = new Map<string, CorpusItem>()

  for (const [i, start] of starts.entries()) {
    const nextHeading = starts[i + 1]?.index ?? lines.length
    let end = Math.min(nextHeading, start.index + 1 + MAX_BODY_LINES)

    // A chapter heading also terminates a body.
    for (let j = start.index + 1; j < end; j++) {
      if (CHAPTER_RE.test(lines[j] ?? '')) {
        end = j
        break
      }
    }

    const text = lines
      .slice(start.index, end)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    const item: CorpusItem = {
      id: start.id,
      kind: start.kind,
      chapter: start.chapter,
      edition,
      text,
    }

    const existing = best.get(start.id)
    if (!existing || item.text.length > existing.text.length) best.set(start.id, item)
  }

  return [...best.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
}

/** Item id to the editions containing it. Two editions means durable core material. */
export function weightSignal(items: CorpusItem[]): Record<string, string[]> {
  const byId = new Map<string, Set<string>>()
  for (const item of items) {
    const set = byId.get(item.id) ?? new Set<string>()
    set.add(item.edition)
    byId.set(item.id, set)
  }
  const out: Record<string, string[]> = {}
  for (const [id, editions] of [...byId.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], 'en', { numeric: true }),
  )) {
    out[id] = [...editions].sort()
  }
  return out
}

async function extract(pdf: string): Promise<string> {
  // pdftotext is the rootless poppler wrapper in ~/.local/bin.
  const { stdout } = await run('pdftotext', ['-layout', pdf, '-'], {
    maxBuffer: 256 * 1024 * 1024,
  })
  return stdout
}

async function main(): Promise<number> {
  const editions = [
    {
      tag: 'r9',
      pdf: '/mnt/c/Users/DaxAxisTangco/Downloads/(REFERENCE) Red Hat RHCSA 9 Cert Guide EX200.pdf',
    },
    {
      tag: 'r10',
      pdf: '/mnt/c/Users/DaxAxisTangco/Downloads/Red_Hat_RHCSA_10_Cert_Guide_EX200_ER_-_Sander_van_Vugt.pdf',
    },
  ]

  const all: CorpusItem[] = []

  for (const edition of editions) {
    const text = await extract(edition.pdf)
    const items = findItems(text, edition.tag)
    all.push(...items)

    const dir = join('corpus', edition.tag)
    await mkdir(dir, { recursive: true })

    const labs = items.filter((i) => i.kind === 'lab')
    const exercises = items.filter((i) => i.kind === 'exercise')
    await writeFile(join(dir, 'labs.json'), `${JSON.stringify(labs, null, 2)}\n`)
    await writeFile(join(dir, 'exercises.json'), `${JSON.stringify(exercises, null, 2)}\n`)

    process.stdout.write(`${edition.tag}: ${labs.length} labs, ${exercises.length} exercises\n`)
  }

  const signal = weightSignal(all)
  await writeFile('corpus/signal.json', `${JSON.stringify(signal, null, 2)}\n`)

  const both = Object.values(signal).filter((e) => e.length === 2).length
  process.stdout.write(`cross-edition items (durable core): ${both}\n`)
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 5 new tests PASS; typecheck clean.

- [ ] **Step 5: Run the extraction for real and check it against the measured counts**

Run: `cd /home/daxtangco/rhcsa-trainer && node scripts/extract-corpus.ts`

Expected output, matching the counts recorded in spec §2:
```
r9: 30 labs, 95 exercises
r10: 28 labs, 85 exercises
cross-edition items (durable core): 112
```

The cross-edition figure is 28 shared labs + 84 shared exercises. **If the lab or exercise counts differ from these, stop and investigate rather than adjusting the expectation** — these numbers were measured directly from the PDFs and a mismatch means the slicing logic is wrong.

Spot-check one extracted body:
```bash
cd /home/daxtangco/rhcsa-trainer
node --input-type=module -e "const l = JSON.parse(await (await import('node:fs/promises')).readFile('corpus/r9/labs.json','utf8')); console.log(l.find(i=>i.id==='Lab 15.1').text.slice(0,400))"
```
Expected: the real end-of-chapter lab text, not a one-line table-of-contents entry.

- [ ] **Step 6: Commit**

`corpus/` is git-ignored (Task 1) because it is regenerable output derived from copyrighted PDFs. Only the script is committed.

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add scripts/extract-corpus.ts test/corpus && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(corpus): extract labs and exercises from both editions

Longest-body-wins deduplication handles every id appearing in both the table
of contents and the real heading. signal.json records which editions contain
each item, which seeds task weight per spec section 14.4. Output stays
git-ignored: it is regenerable and derived from copyrighted PDFs."
```

---

## Part 2 — The VM and the control plane (Tasks 15–20)

These tasks touch VMware Workstation. Tasks 16, 17, 18 and 20 are written and unit-tested against fakes today; each has one clearly marked **acceptance step** that needs a running VM. Task 16's acceptance step runs against the **existing Ubuntu VM** and needs no ISO.

---

