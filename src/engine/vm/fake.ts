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
  readonly kind: TransportKind = 'fake'
  readonly calls: string[] = []
  #handler: FakeHandler
  #available: boolean

  constructor(handler: FakeHandler, opts?: { available?: boolean }) {
    this.#handler = handler
    this.#available = opts?.available ?? true
  }

  async exec(script: string): Promise<ExecResult> {
    this.calls.push(script)
    return await this.#handler(script)
  }

  async isAvailable(): Promise<boolean> {
    return this.#available
  }
}
