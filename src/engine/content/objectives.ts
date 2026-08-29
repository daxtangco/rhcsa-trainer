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
  if (!Array.isArray(raw.objectives)) {
    problems.push('objectives must be a list of objectives')
  } else if (list.length === 0) {
    problems.push('objectives must list at least one objective')
  }

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
