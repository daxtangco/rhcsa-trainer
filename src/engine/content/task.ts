import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { ContentError } from './errors.ts'

export type TaskScope = 'exam-objective' | 'instrumental'
export type TaskWeight = 'low' | 'medium' | 'high'
export type TaskTransport = 'ssh' | 'vmrun'

/**
 * The three enumerations `task.yaml` is validated against, keyed by the union each
 * one enumerates rather than typed `readonly string[]`.
 *
 * The type was the defect, not the contents. `readonly string[]` cannot be checked
 * against its union, so `SCOPES.includes(raw.scope as string)` was a membership
 * test against a list nothing tied to `TaskScope`, and the `as TaskScope` that
 * followed it was load-bearing and unchecked — `includes` on a `string[]` narrows
 * nothing. Adding a member to any of these three types compiled clean while the
 * loader rejected every task declaring it, with a message naming the old list.
 *
 * **`TRANSPORTS` is keyed by `TaskTransport`, not by `TransportKind`, and that is
 * the whole point of writing it out.** `TransportKind` (`src/engine/vm/config.ts`)
 * has a third member, `fake`, which is the in-process test double. A `TRANSPORTS`
 * made exhaustive against *that* type would accept `transport: fake` in a shipped
 * `task.yaml` — a task whose grading runs against a stub that agrees with
 * everything, which is a false pass by construction and the exact class of defect
 * this fix round exists to close. The two unions are deliberately different and
 * this record must follow the narrower one.
 */
/**
 * Exported because `src/server/reports.ts` needs the same exhaustiveness for the
 * dashboard's scope breakdown, and had been keeping a second copy of this literal.
 * Two lists of the same union is one list that will be wrong: the copy is the one
 * nobody remembers when a third scope is added, and a scope missing from the
 * breakdown reads as "not tracked" rather than "none of those".
 */
export const SCOPES: Record<TaskScope, true> = { 'exam-objective': true, instrumental: true }
const WEIGHTS: Record<TaskWeight, true> = { low: true, medium: true, high: true }
const TRANSPORTS: Record<TaskTransport, true> = { ssh: true, vmrun: true }

function isScope(v: unknown): v is TaskScope {
  return typeof v === 'string' && Object.hasOwn(SCOPES, v)
}

function isWeight(v: unknown): v is TaskWeight {
  return typeof v === 'string' && Object.hasOwn(WEIGHTS, v)
}

function isTransport(v: unknown): v is TaskTransport {
  return typeof v === 'string' && Object.hasOwn(TRANSPORTS, v)
}

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

  // The predicate is asked once and its answer decides both the value and the
  // problem, so the fallback and the message can no longer disagree about whether
  // the input was acceptable. Listing the accepted values still reads them off the
  // record, so a member added to the type appears in the message for free.
  const scope: TaskScope = isScope(raw.scope) ? raw.scope : 'exam-objective'
  if (!isScope(raw.scope)) {
    problems.push(`scope must be one of: ${Object.keys(SCOPES).join(', ')}`)
  }

  const weight: TaskWeight = isWeight(raw.weight) ? raw.weight : 'medium'
  if (!isWeight(raw.weight)) {
    problems.push(`weight must be one of: ${Object.keys(WEIGHTS).join(', ')}`)
  }

  const rawTransport = raw.transport ?? 'ssh'
  const transport: TaskTransport = isTransport(rawTransport) ? rawTransport : 'ssh'
  if (!isTransport(rawTransport)) {
    problems.push(`transport must be one of: ${Object.keys(TRANSPORTS).join(', ')}`)
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
