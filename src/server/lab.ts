import { grade, type GradeResult } from '../engine/grading/grader.ts'
import type { TaskSpec } from '../engine/content/task.ts'
import type { ExecResult, LabTransport, TransportKind } from '../engine/vm/transport.ts'
import type { VmController } from '../engine/vm/vmrun.ts'

export interface LabRuntime {
  readonly transportKind: TransportKind
  /**
   * The snapshot `reset` reverts to. Exposed because section 5.5's guard records
   * which snapshot a task's setup was applied on top of (`vm_state.current_snapshot`),
   * and the runtime is the only thing that knows the name — reading `RHCSA_SNAPSHOT`
   * a second time in the server would be a second source of truth for one value.
   */
  readonly snapshot: string
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
  /**
   * Passed to `grade()` as its post-reboot fallback; the reasoning is on
   * `GradeOptions.fallback`. It matters more here than in the validator, because
   * here the person who broke the control channel is a student who has no idea
   * they did: un-persisting `/home` is a realistic wrong answer to
   * `storage/014-grow-home-lv`, and it takes their own ssh key with it. Without
   * this they get every checkpoint failed and a message about the transport; with
   * it they get the persistence verdict they earned.
   *
   * Optional, and `exec` deliberately does not use it: `setup.sh` runs through
   * `exec`, and a lab that cannot be *set up* over the chosen channel must fail
   * loudly rather than half-run somewhere else.
   */
  fallback?: LabTransport
}

export function createLabRuntime(opts: LabRuntimeOptions): LabRuntime {
  return {
    transportKind: opts.transport.kind,
    snapshot: opts.snapshot,
    reset: () => opts.controller.revert(opts.snapshot),
    exec: (script) => opts.transport.exec(script),
    gradeTask: (task, gradeScript) =>
      grade({
        task,
        transport: opts.transport,
        gradeScript,
        reboot: () => opts.controller.reboot(),
        ...(opts.fallback ? { fallback: opts.fallback } : {}),
      }),
  }
}
