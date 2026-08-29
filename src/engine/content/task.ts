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
  const requiresDisks = intInRange(
    raw.requires_disks ?? 0,
    'requires_disks',
    0,
    MAX_SPARE_DISKS,
    problems,
  )

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
