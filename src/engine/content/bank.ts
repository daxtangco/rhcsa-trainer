import type { Dirent } from 'node:fs'
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Renders a rejected loader's failure as attributable problem strings. A
 * `ContentError` already carries `where`, so each of its problems is
 * prefixed with that to stay attributable once merged into the bank's
 * aggregate. Anything else (a `YAMLException`, a bare Node `ENOENT`) is
 * rendered as one problem naming the file that failed and the error message,
 * so no raw, non-`ContentError` value ever escapes `loadBank`.
 */
function describeFailure(file: string, error: unknown): string[] {
  if (error instanceof ContentError) {
    return error.problems.map((p) => `${error.where}: ${p}`)
  }
  return [`${file}: ${errorMessage(error)}`]
}

/**
 * A missing or unreadable directory is recorded as a problem rather than
 * silently treated as "no files here yet" (see bank.ts deviation 2): an
 * author who mistypes `tasks/` must be told, not shown an empty bank that
 * looks identical to normal authoring progress.
 */
async function readDirEntries(root: string, problems: string[]): Promise<Dirent[]> {
  try {
    return await readdir(root, { recursive: true, withFileTypes: true })
  } catch (error) {
    problems.push(`cannot read directory ${root}: ${errorMessage(error)}`)
    return []
  }
}

async function findFiles(root: string, filename: string, problems: string[]): Promise<string[]> {
  const entries = await readDirEntries(root, problems)
  return entries
    .filter((e) => e.isFile() && e.name === filename)
    .map((e) => join(e.parentPath, e.name))
}

async function findMarkdown(root: string, problems: string[]): Promise<string[]> {
  const entries = await readDirEntries(root, problems)
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => join(e.parentPath, e.name))
    .sort()
}

export async function loadBank(root: string): Promise<Bank> {
  const problems: string[] = []

  // A single-element array literal keeps this a fixed-length tuple to
  // TypeScript, so destructuring it is not an indexed access and needs no
  // narrowing under `noUncheckedIndexedAccess`.
  const [objectivesResult] = await Promise.allSettled([loadObjectives(join(root, 'objectives.yaml'))])
  if (objectivesResult.status === 'rejected') {
    problems.push(...describeFailure(join(root, 'objectives.yaml'), objectivesResult.reason))
  }

  const taskFiles = (await findFiles(join(root, 'tasks'), 'task.yaml', problems)).sort()
  const taskSettled = await Promise.allSettled(taskFiles.map((f) => loadTask(dirname(f))))
  const tasks: TaskSpec[] = []
  for (const [i, result] of taskSettled.entries()) {
    const file = taskFiles[i]
    if (file === undefined) continue
    if (result.status === 'fulfilled') {
      tasks.push(result.value)
    } else {
      problems.push(...describeFailure(file, result.reason))
    }
  }

  const conceptFiles = await findMarkdown(join(root, 'concepts'), problems)
  const conceptSettled = await Promise.allSettled(conceptFiles.map((f) => loadConcept(f)))
  const concepts: ConceptSpec[] = []
  for (const [i, result] of conceptSettled.entries()) {
    const file = conceptFiles[i]
    if (file === undefined) continue
    if (result.status === 'fulfilled') {
      concepts.push(result.value)
    } else {
      problems.push(...describeFailure(file, result.reason))
    }
  }

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

  // Every failure path above (loader rejections, duplicate ids, unreadable
  // directories) has already been folded into `problems`. Throw once, here,
  // covering all of them together — this is also the only branch below that
  // needs to dereference `objectivesResult.value`, so checking its status in
  // this condition proves to the type checker that the failure path always
  // throws before that dereference happens.
  if (problems.length > 0 || objectivesResult.status !== 'fulfilled') {
    throw new ContentError(root, problems)
  }

  return {
    root,
    objectives: objectivesResult.value,
    tasks,
    concepts,
    tasksById,
    conceptsById,
  }
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
