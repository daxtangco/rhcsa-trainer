import type { ExecResult, LabTransport, TransportKind } from './transport.ts'

export type FakeHandler = (script: string) => ExecResult | Promise<ExecResult>

/**
 * In-memory transport. Exists so the whole engine — loaders, grading
 * sequence, ladder, validate harness — is testable with no hypervisor.
 *
 * Handlers are deliberately tiny state machines. Do NOT grow this into a
 * simulated Linux: the spec's central architectural decision is that command
 * semantics are the real kernel's job, and a fake that pretends otherwise
 * would let a broken grader pass its own tests.
 */
export class FakeTransport implements LabTransport {
  /**
   * `'fake'` unless a test says otherwise, and the override is not cosmetic:
   * `grade()`'s post-reboot fallback is guarded on `transport.kind !== fallback.kind`,
   * so a suite in which every transport reports the same kind cannot reach that
   * branch at all. Labelling a fake `'ssh'` or `'vmrun'` is how a test states which
   * *role* it is standing in for. Nothing dispatches on `kind`, so this changes no
   * behaviour beyond the comparison it exists to make reachable.
   */
  readonly kind: TransportKind
  readonly calls: string[] = []
  #handler: FakeHandler
  #available: boolean

  constructor(handler: FakeHandler, opts?: { available?: boolean; kind?: TransportKind }) {
    this.#handler = handler
    this.#available = opts?.available ?? true
    this.kind = opts?.kind ?? 'fake'
  }

  async exec(script: string): Promise<ExecResult> {
    this.calls.push(script)
    return await this.#handler(script)
  }

  async isAvailable(): Promise<boolean> {
    return this.#available
  }
}
