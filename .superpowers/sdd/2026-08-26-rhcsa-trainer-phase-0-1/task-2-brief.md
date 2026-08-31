### Task 2: `LabTransport` interface and `FakeTransport`

This task is what decouples the entire engine from the missing ISO. It comes second for that reason.

**Files:**
- Create: `src/engine/vm/transport.ts`, `src/engine/vm/fake.ts`, `src/engine/content/errors.ts`
- Test: `test/fake-transport.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ExecResult { stdout: string; stderr: string; code: number }`
  - `interface LabTransport { readonly kind: TransportKind; exec(script: string): Promise<ExecResult>; isAvailable(): Promise<boolean> }`
  - `type TransportKind = 'ssh' | 'vmrun' | 'fake'`
  - `class FakeTransport implements LabTransport` with constructor `(handler: FakeHandler, opts?: { available?: boolean })`, field `calls: string[]`, and `type FakeHandler = (script: string) => ExecResult | Promise<ExecResult>`
  - `class ContentError extends Error` with fields `where: string`, `problems: string[]`

- [ ] **Step 1: Write the failing test**

`test/fake-transport.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { FakeTransport } from '../src/engine/vm/fake.ts'

describe('FakeTransport', () => {
  it('returns what the handler produces and records the script', async () => {
    const t = new FakeTransport((script) => ({
      stdout: script.includes('lvs') ? 'rhel var 6.00g' : '',
      stderr: '',
      code: 0,
    }))

    const r = await t.exec('lvs --noheadings')

    expect(r.stdout).toBe('rhel var 6.00g')
    expect(r.code).toBe(0)
    expect(t.calls).toEqual(['lvs --noheadings'])
  })

  it("returns the handler's result unchanged", async () => {
    const t = new FakeTransport(() => ({ stdout: 'ok', stderr: '', code: 0 }))
    await expect(t.exec('true')).resolves.toEqual({ stdout: 'ok', stderr: '', code: 0 })
  })

  it('supports simulating an unreachable VM', async () => {
    const t = new FakeTransport(() => ({ stdout: '', stderr: '', code: 0 }), { available: false })
    await expect(t.isAvailable()).resolves.toBe(false)
  })

  it('reports kind "fake" so callers can assert they are not on real hardware', () => {
    const t = new FakeTransport(() => ({ stdout: '', stderr: '', code: 0 }))
    expect(t.kind).toBe('fake')
  })

  it('lets a handler hold mutable state across calls', async () => {
    // This is the pattern every grading test uses: the handler is a tiny
    // state machine, never a simulated Linux.
    let varSizeGb = 2
    const t = new FakeTransport((script) => {
      if (script.startsWith('lvextend')) {
        varSizeGb = 6
        return { stdout: '', stderr: '', code: 0 }
      }
      return { stdout: `${varSizeGb}`, stderr: '', code: 0 }
    })

    expect((await t.exec('lvs')).stdout).toBe('2')
    await t.exec('lvextend -L 6G /dev/rhel/var')
    expect((await t.exec('lvs')).stdout).toBe('6')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/fake-transport.test.ts`
Expected: FAIL — `Cannot find module '../src/engine/vm/fake.ts'`.

- [ ] **Step 3: Write the implementation**

`src/engine/vm/transport.ts`:

```ts
export type TransportKind = 'ssh' | 'vmrun' | 'fake'

export interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

/**
 * The only channel the engine uses to touch the VM.
 *
 * Two real implementations exist because neither alone covers the objective
 * list: SSH is fast but dies on exactly the labs that matter most (root
 * password recovery, GRUB, broken fstab, firewall lockout), and vmrun keeps
 * working there because it goes through open-vm-tools instead of the network.
 */
export interface LabTransport {
  readonly kind: TransportKind
  /** Run a bash script in the guest as root. Never throws on non-zero exit. */
  exec(script: string): Promise<ExecResult>
  isAvailable(): Promise<boolean>
}
```

`src/engine/vm/fake.ts`:

```ts
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
```

`src/engine/content/errors.ts`:

```ts
/**
 * Aggregating content error. Reports every problem found in a file at once
 * rather than failing on the first, because content authoring is a loop and
 * one-error-per-run makes that loop slow.
 *
 * Note the explicit field declarations: parameter properties are not erasable
 * syntax and would break `node file.ts` (see Global Constraints).
 */
export class ContentError extends Error {
  readonly where: string
  readonly problems: string[]

  constructor(where: string, problems: string[]) {
    super(`${where}: ${problems.length} problem(s)\n  - ${problems.join('\n  - ')}`)
    this.name = 'ContentError'
    this.where = where
    this.problems = problems
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 5 new tests PASS (7 total); typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/engine test/fake-transport.test.ts && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(vm): add LabTransport interface and FakeTransport

Comes before any real transport so the engine is testable with no hypervisor,
which is what lets Part 1 proceed while the RHEL 9 ISO is still undownloaded.
FakeTransport handlers are state machines by design, not a simulated Linux."
```

---

