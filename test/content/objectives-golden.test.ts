import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { loadObjectives } from '../../src/engine/content/objectives.ts'

// Locks the full `id -> { text, chapters }` map of both objective taxonomies
// against a committed fixture.
//
// Why this exists: the ids in content/objectives*.yaml are permanent FSRS
// scheduling keys and the texts and chapters are transcribed fact, but the
// structural tests in objectives-real.test.ts cannot see a silent edit to them.
// Three mutations passed that whole file: changing a `chapters:` value,
// rewording a `text:` on any id not shared between the two editions, and
// merging two bullets into one entry. Fidelity to the source is the entire point
// of these files, so it needs to be enforced rather than assumed.
//
// The effect is that any future edit to either YAML must come with a fixture
// diff, which a reviewer can read row by row against the Cert Guide tables.
//
// TO REGENERATE after a deliberate change, from the repo root:
//
//   node --experimental-strip-types -e "
//   import { writeFile } from 'node:fs/promises';
//   const { loadObjectives } = await import('./src/engine/content/objectives.ts');
//   for (const [src, out] of [
//     ['content/objectives.yaml', 'test/fixtures/objectives-rhel9.golden.json'],
//     ['content/objectives-rhel10.yaml', 'test/fixtures/objectives-rhel10.golden.json'],
//   ]) {
//     const set = await loadObjectives(src);
//     const map = {};
//     for (const id of set.objectives.map((o) => o.id).sort()) {
//       const o = set.byId.get(id);
//       map[id] = { text: o.text, chapters: o.chapters };
//     }
//     await writeFile(out, JSON.stringify(map, null, 2) + '\n', 'utf8');
//   }"
//
// Always regenerate; never hand-edit a fixture. Hand-transcribing it would
// reintroduce exactly the copying risk this test exists to close.

const ROOT = new URL('../../content/', import.meta.url).pathname
const FIXTURES = new URL('../fixtures/', import.meta.url).pathname

interface Entry {
  text: string
  chapters: number[]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((n) => typeof n === 'number')
}

interface Golden {
  entries: Map<string, Entry>
  problems: string[]
}

// Validates the fixture itself, so a corrupt fixture is reported as a corrupt
// fixture rather than showing up as spurious drift in every row.
async function readGolden(name: string): Promise<Golden> {
  const raw: unknown = JSON.parse(await readFile(`${FIXTURES}${name}`, 'utf8'))
  const entries = new Map<string, Entry>()
  const problems: string[] = []

  if (!isRecord(raw)) {
    problems.push(`${name} must contain a JSON object mapping id -> { text, chapters }`)
    return { entries, problems }
  }

  for (const [id, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) {
      problems.push(`${name}: ${id} must be an object with text and chapters`)
      continue
    }
    const { text, chapters } = entry
    if (typeof text !== 'string' || text.trim() === '') {
      problems.push(`${name}: ${id}.text must be a non-empty string`)
      continue
    }
    if (!isNumberArray(chapters) || chapters.length === 0) {
      problems.push(`${name}: ${id}.chapters must be a non-empty array of numbers`)
      continue
    }
    entries.set(id, { text, chapters })
  }

  return { entries, problems }
}

async function loadActual(file: string): Promise<Map<string, Entry>> {
  const set = await loadObjectives(`${ROOT}${file}`)
  return new Map(set.objectives.map((o) => [o.id, { text: o.text, chapters: o.chapters }]))
}

// House style: report every divergence in one pass, each naming its id, so a
// mistranscription is fixed in one edit rather than one test run per row.
function drifts(actual: Map<string, Entry>, golden: Map<string, Entry>): string[] {
  const problems: string[] = []

  for (const [id, a] of actual) {
    const g = golden.get(id)
    if (g === undefined) {
      problems.push(`${id}: in the YAML but not the fixture (added or renamed id)`)
      continue
    }
    if (a.text !== g.text) {
      problems.push(`${id}: text drifted\n    fixture: ${g.text}\n    yaml:    ${a.text}`)
    }
    if (a.chapters.length !== g.chapters.length || a.chapters.some((c, i) => c !== g.chapters[i])) {
      problems.push(
        `${id}: chapters drifted - fixture [${g.chapters.join(', ')}], yaml [${a.chapters.join(', ')}]`,
      )
    }
  }

  for (const id of golden.keys()) {
    if (!actual.has(id)) {
      problems.push(`${id}: in the fixture but not the YAML (removed, renamed or merged away)`)
    }
  }

  return problems
}

async function expectMatchesGolden(file: string, fixture: string): Promise<void> {
  const actual = await loadActual(file)
  const { entries, problems } = await readGolden(fixture)

  expect(problems, `test/fixtures/${fixture} is malformed:\n${problems.join('\n')}`).toEqual([])

  const drift = drifts(actual, entries)
  expect(
    drift,
    `content/${file} has drifted from test/fixtures/${fixture}.\n` +
      `If the change was deliberate, re-verify it against the Cert Guide table and regenerate ` +
      `the fixture (see the header of this file). Divergences:\n${drift.join('\n')}`,
  ).toEqual([])

  expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(entries))
}

describe('objective taxonomy golden fixtures', () => {
  it('content/objectives.yaml matches its golden fixture exactly', async () => {
    await expectMatchesGolden('objectives.yaml', 'objectives-rhel9.golden.json')
  })

  it('content/objectives-rhel10.yaml matches its golden fixture exactly', async () => {
    await expectMatchesGolden('objectives-rhel10.yaml', 'objectives-rhel10.golden.json')
  })
})
