import { grade, type GradeResult } from '../engine/grading/grader.ts'
import type { TaskSpec } from '../engine/content/task.ts'
import type { ExecResult, LabTransport, TransportKind } from '../engine/vm/transport.ts'
import type { VmController } from '../engine/vm/vmrun.ts'

export interface LabRuntime {
  readonly transportKind: TransportKind
  /** Return the guest to the clean snapshot. */
  reset(): Promise<void>
  /** Run a script in the guest (used for setup.sh). */
  exec(script: string): Promise<ExecResult>
  gradeTask(task: TaskSpec, gradeScript: string): Promise<GradeResult>
}

export interface LabRuntimeOptions {
  transport: LabTransport
  controller: VmController
  snapshot: string
}

export function createLabRuntime(opts: LabRuntimeOptions): LabRuntime {
  return {
    transportKind: opts.transport.kind,
    reset: () => opts.controller.revert(opts.snapshot),
    exec: (script) => opts.transport.exec(script),
    gradeTask: (task, gradeScript) =>
      grade({
        task,
        transport: opts.transport,
        gradeScript,
        reboot: () => opts.controller.reboot(),
      }),
  }
}
