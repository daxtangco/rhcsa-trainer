import type { TaskSpec } from '../content/task.ts'
import type { FixtureResult, HarnessDeps, TaskScripts } from './harness.ts'
import { validateTask } from './harness.ts'

export interface ValidateOptions {
  tasks: TaskSpec[]
  assertLib: string
  deps: HarnessDeps
  loadScripts: (task: TaskSpec, assertLib: string) => Promise<TaskScripts>
  onTask?: (taskId: string) => void
}

export interface ValidateSummary {
  results: FixtureResult[]
  failed: FixtureResult[]
}

/**
 * Run every fixture of every task. Never throws for content reasons: a task
 * whose scripts will not load is reported as a failed result, so one broken
 * task does not hide the state of the others.
 */
export async function validateBank(opts: ValidateOptions): Promise<ValidateSummary> {
  const results: FixtureResult[] = []

  for (const task of opts.tasks) {
    opts.onTask?.(task.id)

    let scripts: TaskScripts
    try {
      scripts = await opts.loadScripts(task, opts.assertLib)
    } catch (e) {
      results.push({
        taskId: task.id,
        kind: 'none',
        name: 'load-scripts',
        ok: false,
        failures: [e instanceof Error ? e.message : String(e)],
      })
      continue
    }

    results.push(...(await validateTask(task, scripts, opts.deps)))
  }

  return { results, failed: results.filter((r) => !r.ok) }
}
