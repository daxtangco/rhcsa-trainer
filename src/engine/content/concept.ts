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

export function parseConcept(text: string, path: string): ConceptSpec {
  const problems: string[] = []
  const parsed = matter(text)
  const fm = parsed.data as Record<string, unknown>

  const id = typeof fm.id === 'string' && CONCEPT_ID_RE.test(fm.id) ? fm.id : ''
  if (!id) problems.push('id must be dotted lowercase, e.g. storage.lvm-abstraction-stack')

  const title = typeof fm.title === 'string' && fm.title.trim() !== '' ? fm.title : ''
  if (!title) problems.push('title must be a non-empty string')

  const rhel = intInRange(fm.rhel, 'rhel', 9, 10, problems)

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
