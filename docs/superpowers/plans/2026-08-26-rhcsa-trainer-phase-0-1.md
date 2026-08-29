# RHCSA Lab Trainer — Phase 0 + Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the engine, content bank, and Lab screen needed for the user to complete one real graded LVM lab end to end against a RHEL 9 VM — including the post-reboot persistence check — having learned the concept from a concept card rather than a book.

**Architecture:** A TypeScript library (`src/engine/`) with no HTTP awareness, wrapped by a thin CLI and a Hono server. Content is files on disk (YAML + Markdown + Bash); only user history would go in SQLite (deferred to Phase 2). The engine talks to the VM exclusively through the `LabTransport` interface, which has three implementations: `FakeTransport` (in-memory, for tests), `SshTransport` (primary), and `VmrunTransport` (fallback). Graders are Bash scripts emitting JSONL, so they are language-agnostic and testable in isolation.

**Tech Stack:** Node 22.23.2 (native TypeScript stripping, no build step), Vitest, Hono, `js-yaml`, `gray-matter`, `ws`, Vite + React + Tailwind, `xterm.js`. Bash 5.3 for graders and provisioning.

**Spec:** `docs/superpowers/specs/2026-08-26-rhcsa-lab-trainer-design.md`

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Node >= 22.23.2.** Verified present. `node file.ts` executes TypeScript directly — there is no build step and no `tsx`/`ts-node` dependency.
- **Erasable syntax only.** Node's type stripping cannot handle TypeScript constructs that emit runtime code. **Never write** `enum`, `namespace`, parameter properties (`constructor(private readonly x: T)`), or `experimentalDecorators`. Use `const` objects with `as const` plus union types instead of `enum`, and explicit field declarations plus assignments in constructors. `tsconfig.json` sets `erasableSyntaxOnly: true` so violations fail typecheck rather than surfacing at runtime.
- **Relative imports carry the `.ts` extension** (`import { x } from './y.ts'`). Required by Node's ESM resolver. `tsconfig.json` sets `allowImportingTsExtensions: true`.
- **ESM only.** `package.json` has `"type": "module"`. No `require`.
- **`sudo` cannot authenticate in this environment — there is no TTY.** Never write a task step that needs root on the WSL host. Guest-side root is fine, but it is *arranged*, not free: both transports connect as `student`, and `guest-provision.sh` installs `/etc/sudoers.d/rhcsa-trainer` granting `student` passwordless `sudo`. Every guest-side script — `setup.sh`, `grade.sh`, solutions, anti-solutions — therefore calls `sudo` explicitly and non-interactively. A guest-side script that assumes it is already root is a bug. Host-side tooling installs rootless into `~/.local` (this is how `poppler` 26.01.0 was installed).
- **Target exam version is RHEL 9.** Every `task.yaml` and concept front matter carries `rhel: 9`. Do not add RHEL 10 content in these phases.
- **SELinux stays `enforcing` in the VM.** Never disable or permissive it to make a task pass.
- **Graders are read-only and their exit code is ignored** (spec §6.5). A grader that repairs state, or that aborts on first failure, is a defect.
- **Graders never read shell history.** Grade end state, not commands (spec §6.5 rule 1). The Phase 4 coaching module is the only consumer of history and does not exist yet.
- **`vmrun.exe` path** is `/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe` — note the space, always quote it.
- **Do not read or copy anything from `/home/daxtangco/sechelp-tools`.** It is an unrelated project containing `.env` secrets.
- **Commit after every task.** Git identity must be passed explicitly, as the repo has none configured:
  `GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost git commit -m "..."`

### External blockers

Two items are outside the implementing agent's control. **Part 1 and Part 3's UI tasks are deliberately independent of both**, so work starts immediately.

| Blocker | Blocks | Owner |
|---|---|---|
| RHEL 9 binary DVD ISO not downloaded (needs the user's own Red Hat account at developers.redhat.com) | Tasks 19–22 fully; the **acceptance steps only** of 17, 18, 20; Task 25 entirely | **User** |
| Risk R1: WSL2 → VMnet8 reachability unverified | Task 18 (`SshTransport` acceptance) | Task 16 answers it using the **existing Ubuntu VM** — no ISO needed |

Tasks 1–14 and 23–24 are unblocked and can be built today. Tasks 17, 18 and 20 are written and unit-tested against fakes now, with a clearly marked acceptance step deferred until the VM exists.

---

## File Structure

```
rhcsa-trainer/
├── package.json                        deps + scripts, ESM, no build step
├── tsconfig.json                       strict, erasableSyntaxOnly, noEmit
├── vitest.config.ts                    test roots; `test/**/*.vm.test.ts` needs `RHCSA_VM=1`
├── vite.config.ts                      T24: react, tailwind, /api + /ws proxy
├── index.html                          T24: the single page
├── README.md                           T15 + T25: build the VM, then run it
├── .env.local                          git-ignored: RHCSA_VMX, RHCSA_VM_IP, ...
├── docs/
│   ├── superpowers/specs/…              the design spec
│   ├── superpowers/plans/…              this plan
│   ├── vm-build-checklist.md           T15: manual install steps + LVM layout
│   ├── r1-findings.md                  T16: the answer to risk R1
│   ├── coverage-phase-1.md             T25: objectives covered, and the gap
│   └── exit-criterion.md               T25: the recorded run, by hand
├── scripts/
│   ├── extract-corpus.ts               T14: PDFs → corpus/*.json
│   ├── r1-probe.sh                     T16: answers risk R1
│   ├── provision.sh                    T19: idempotent guest setup
│   └── guest-provision.sh              T19: runs *inside* the guest; everything `provision.sh` cannot do over vmrun
├── corpus/                             T14 output; git-ignored, regenerable
├── content/
│   ├── objectives.yaml                 T13: RHEL 9 EX200 taxonomy
│   ├── objectives-rhel10.yaml          T13: R2 hedge, loaded by nothing yet
│   ├── lib/assert.sh                   T20: checkpoint emitters + helpers
│   ├── concepts/**/*.md                T21/T22: front matter + prose
│   └── tasks/<area>/<nnn>-<slug>/      T21/T22
│       ├── task.yaml  setup.sh  grade.sh
│       ├── solutions/*.sh              ≥2, independent correct paths
│       └── antisolutions/*.sh          wrong-but-plausible, declare failures
└── src/
    ├── engine/                         no HTTP, no browser, no VM required
    │   ├── content/
    │   │   ├── errors.ts               T2: ContentError (aggregating)
    │   │   ├── task.ts                 T3: TaskSpec + loadTask
    │   │   ├── concept.ts              T4: ConceptSpec + loadConcept
    │   │   ├── objectives.ts           T6: ObjectiveSet + loadObjectives
    │   │   └── bank.ts                 T7: loadBank + checkCoverage
    │   ├── grading/
    │   │   ├── verdict.ts              T5: JSONL → Verdict
    │   │   └── grader.ts               T8: verdict A/B + regressions
    │   ├── disclosure/
    │   │   ├── ladder.ts               T9: rungs, caps, deriveRating
    │   │   └── content.ts              T23: rungContent + commandSketch
    │   ├── exam/
    │   │   └── limits.ts               T9: EX200 duration + passing score (UNCONFIRMED)
    │   ├── validate/
    │   │   ├── expectations.ts         T10: antisolution header parser
    │   │   ├── harness.ts              T11: one task's fixture matrix
    │   │   └── run.ts                  T21: validateBank over many tasks
    │   └── vm/
    │       ├── transport.ts            T2: LabTransport interface
    │       ├── fake.ts                 T2: FakeTransport
    │       ├── config.ts               T17: VmConfig + loadVmConfig
    │       ├── vmrun.ts                T17: VmrunTransport + VmController
    │       ├── ssh.ts                  T18: SshTransport
    │       └── select.ts               T18: chooseTransport + NoTransportError
    ├── cli/index.ts                    T12: coverage; T21: validate
    ├── server/
    │   ├── app.ts                      T23: Hono routes over the engine
    │   ├── session.ts                  T23: SessionStore, masking, reportFor
    │   ├── lab.ts                      T23: LabRuntime — the VM seam app.ts fakes
    │   ├── terminal.ts                 T23: ws bridge + PtyLike + spawnSshPipe
    │   └── index.ts                    T23: the process — one transport, one port
    └── web/                            T24: the Lab screen
        ├── main.tsx  App.tsx  api.ts  index.css
        └── components/
            ├── Rail.tsx                mode, timer, rung, masked score
            ├── TerminalPane.tsx        xterm over the ws bridge
            └── TaskPicker.tsx          pick a task and a mode

test/
├── …                                   mirrors src/, runs with no VM
├── fixtures/                            hand-written banks and task dirs
├── validate/run.test.ts                 T21: validateBank over the real bank
├── web/                                 jsdom, via environmentMatchGlobs
├── vm/                                  transports against fakes (T17, T18)
└── vm/*.vm.test.ts                      needs a live VM: RHCSA_VM=1 (T25)
```

**Why this split.** `engine/` is a library with no knowledge of HTTP or the browser, which is what makes the validate harness runnable in CI and the whole of Part 1 testable with no hypervisor. `content/` is data, not code, so the entire task bank can be renumbered or regenerated without touching `src/` — the same reason SQLite holds only history.

---

## Part 1 — Engine core (no VM required)

Tasks 1–14 have **zero dependency on the ISO or on R1**. They are the whole of Phase 0's data work plus Phase 1's engine.

---

### Task 1: Project scaffold that typechecks and runs a test

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Modify: `.gitignore`
- Test: `test/scaffold.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `npm test` and `npm run typecheck` commands every later task uses; the ESM + erasable-syntax constraints all later code obeys.

- [ ] **Step 1: Write the failing test**

`test/scaffold.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

describe('scaffold', () => {
  it('runs TypeScript under vitest with strict types', () => {
    const n: number = 41
    expect(n + 1).toBe(42)
  })

  it('targets Node 22 or newer', () => {
    const major = Number(process.versions.node.split('.')[0])
    expect(major).toBeGreaterThanOrEqual(22)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx --no vitest run`
Expected: FAIL — the command exits non-zero because vitest is not installed locally yet. `--no` is what keeps it a red probe: without it `npx` would offer to fetch vitest from the registry and the step could pass by accident. This confirms there is no toolchain yet.

- [ ] **Step 3: Write the scaffold**

`package.json`:

```json
{
  "name": "rhcsa-trainer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.18.0" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "rhcsa": "node src/cli/index.ts"
  },
  "dependencies": {
    "gray-matter": "^4.0.3",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^22.10.0",
    "typescript": "^5.8.0",
    "vitest": "^3.0.0"
  }
}
```

`engines.node` is `>=22.18.0`, not the installed 22.23.2: 22.18.0 is where `--experimental-strip-types` became the default, which is the real floor. Do not raise it to match the Global Constraint.

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": false,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "test", "scripts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Registers Vitest's global `afterEach`, which is the only thing that lets
    // @testing-library/react install its automatic DOM cleanup. Without it the
    // component tests of Task 24 accumulate mounted trees and `getByText`
    // starts throwing on duplicate matches. Set here, in Task 1, so the two
    // copies of this file cannot drift.
    globals: true,
    include: ['test/**/*.test.ts'],
    // A suite that needs a live hypervisor is named *.vm.test.ts and opts in
    // via RHCSA_VM=1, so the default `npm test` runs anywhere. The gate is on
    // the filename, not the directory: test/vm/ also holds unit tests that
    // drive vmrun and ssh through fakes, and those must always run. Both arms
    // restate node_modules and dist, because naming `exclude` at all replaces
    // Vitest's defaults rather than adding to them.
    exclude: process.env.RHCSA_VM === '1' ? ['**/node_modules/**', '**/dist/**'] : ['**/node_modules/**', '**/dist/**', 'test/**/*.vm.test.ts'],
    testTimeout: 10_000,
  },
})
```

Append to `.gitignore`:

```
corpus/
coverage/
```

- [ ] **Step 4: Install and run the tests**

Run: `cd /home/daxtangco/rhcsa-trainer && npm install && npm test && npm run typecheck`
Expected: 2 tests PASS; `tsc --noEmit` exits 0 with no output.

- [ ] **Step 5: Verify the erasable-syntax guard actually fires**

This proves the Global Constraint is enforced by the compiler rather than by discipline.

Run:
```bash
cd /home/daxtangco/rhcsa-trainer
mkdir -p src
printf 'export enum Bad { A }\n' > src/_guard.ts
npm run typecheck; echo "exit=$?"
rm src/_guard.ts
rmdir src 2>/dev/null || true
```
Expected: typecheck FAILS citing `erasableSyntaxOnly` on the `enum`, then `exit=2`. If it exits 0, the TypeScript version is too old — raise it to `^5.8.0` and repeat.

- [ ] **Step 6: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore test/scaffold.test.ts && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "chore: scaffold Node 22 + TypeScript + vitest, no build step

Type stripping runs .ts directly, so erasableSyntaxOnly is enabled to make
the no-enum/no-parameter-property constraint a compiler error rather than a
runtime surprise. VM-dependent suites are excluded unless RHCSA_VM=1 so the
default test run needs no hypervisor."
```

---

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

### Task 3: `TaskSpec` loader

**Files:**
- Create: `src/engine/content/task.ts`
- Test: `test/content/task.test.ts`, plus fixtures under `test/fixtures/tasks/`

**Interfaces:**
- Consumes: `ContentError` from `src/engine/content/errors.ts`.
- Produces:
  - `type TaskScope = 'exam-objective' | 'instrumental'`
  - `type TaskWeight = 'low' | 'medium' | 'high'`
  - `interface TaskSpec` with fields `id, title, chapter, scope, rhel, objectives, requiresConcepts, difficulty, timeBudget, weight, editions, rebootCheck, requiresDisks, claims, transport, prompt, dir`
  - `function parseTaskSpec(raw: unknown, dir: string): TaskSpec` (throws `ContentError`)
  - `function loadTask(dir: string): Promise<TaskSpec>`

- [ ] **Step 1: Write the failing test**

Create fixture `test/fixtures/tasks/good/task.yaml`:

```yaml
id: storage/014-shrink-home-grow-var
title: Reclaim space from /home and give it to /var
chapter: 15
scope: exam-objective
rhel: 9
objectives: [storage.lvm.resize, storage.fs.xfs]
requires_concepts:
  - storage.lvm-abstraction-stack
  - storage.why-xfs-cannot-shrink
difficulty: 3
time_budget: 480
weight: high
editions: [r9, r10]
reboot_check: true
requires_disks: 0
claims: [vg:rhel, lv:var]
transport: ssh
prompt: |
  /var is nearly full while /home is mostly empty. Grow the var
  logical volume to at least 6 GB. All filesystems must mount
  correctly on boot.
```

Create fixture `test/fixtures/tasks/bad/task.yaml`:

```yaml
id: Storage/BAD ID
title: ""
chapter: 0
scope: extra-credit
rhel: 9
objectives: []
difficulty: 9
time_budget: -1
weight: enormous
editions: [r9]
reboot_check: yes-please
requires_disks: 4
claims: []
transport: telnet
prompt: ""
```

`test/content/task.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ContentError } from '../../src/engine/content/errors.ts'
import { loadTask } from '../../src/engine/content/task.ts'

const FIXTURES = new URL('../fixtures/tasks/', import.meta.url).pathname

describe('loadTask', () => {
  it('maps snake_case YAML onto camelCase fields', async () => {
    const t = await loadTask(`${FIXTURES}good`)

    expect(t.id).toBe('storage/014-shrink-home-grow-var')
    expect(t.chapter).toBe(15)
    expect(t.scope).toBe('exam-objective')
    expect(t.objectives).toEqual(['storage.lvm.resize', 'storage.fs.xfs'])
    expect(t.requiresConcepts).toEqual([
      'storage.lvm-abstraction-stack',
      'storage.why-xfs-cannot-shrink',
    ])
    expect(t.timeBudget).toBe(480)
    expect(t.rebootCheck).toBe(true)
    expect(t.requiresDisks).toBe(0)
    expect(t.claims).toEqual(['vg:rhel', 'lv:var'])
    expect(t.transport).toBe('ssh')
    expect(t.prompt).toContain('at least 6 GB')
    expect(t.dir).toBe(`${FIXTURES}good`)
  })

  it('defaults the optional fields', async () => {
    // requires_concepts, editions, claims, transport and reboot_check are all
    // omittable; a task with no concepts is legal, just untaught.
    const t = await loadTask(`${FIXTURES}minimal`)
    expect(t.requiresConcepts).toEqual([])
    expect(t.claims).toEqual([])
    expect(t.transport).toBe('ssh')
    expect(t.rebootCheck).toBe(false)
    expect(t.editions).toEqual([])
  })

  it('reports every problem at once rather than the first', async () => {
    const err = await loadTask(`${FIXTURES}bad`).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ContentError)
    const problems = (err as ContentError).problems.join('\n')

    expect(problems).toMatch(/id/)
    expect(problems).toMatch(/title/)
    expect(problems).toMatch(/chapter/)
    expect(problems).toMatch(/scope/)
    expect(problems).toMatch(/objectives/)
    expect(problems).toMatch(/difficulty/)
    expect(problems).toMatch(/time_budget/)
    expect(problems).toMatch(/weight/)
    expect(problems).toMatch(/reboot_check/)
    expect(problems).toMatch(/transport/)
    expect(problems).toMatch(/prompt/)
    // at least 11 of the 12 problems this fixture contains, all surfaced from one load.
    expect((err as ContentError).problems.length).toBeGreaterThanOrEqual(11)
  })

  it('rejects a difficulty outside 1-5 and a requires_disks above 3', async () => {
    const err = (await loadTask(`${FIXTURES}bad`).catch((e: unknown) => e)) as ContentError
    expect(err.problems.join('\n')).toMatch(/difficulty must be an integer 1-5/)
    // Spec section 4.1's VM design has three spare disk slots, so 4 is unsatisfiable.
    expect(err.problems.join('\n')).toMatch(/requires_disks must be an integer 0-3/)
  })
})
```

Also create `test/fixtures/tasks/minimal/task.yaml`:

```yaml
id: users/001-create-account
title: Create a user account
chapter: 6
scope: exam-objective
rhel: 9
objectives: [users.local.create]
difficulty: 1
time_budget: 120
weight: medium
prompt: |
  Create a user named alice.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/content/task.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/content/task.ts'`.

- [ ] **Step 3: Write the implementation**

`src/engine/content/task.ts`:

```ts
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
  const requiresDisks = intInRange(raw.requires_disks ?? 0, 'requires_disks', 0, MAX_SPARE_DISKS, problems)

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 4 new tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/engine/content/task.ts test/content test/fixtures && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(content): add TaskSpec loader with aggregating validation

requires_disks is capped at 3 because spec section 4.1's VM design has three
spare disk slots, so a higher value is unsatisfiable rather than merely
unusual. Phase 1 attaches none of them (Task 19), and every Phase 1 task
declares 0."
```

---

### Task 4: `ConceptSpec` loader

**Files:**
- Create: `src/engine/content/concept.ts`
- Test: `test/content/concept.test.ts`, fixtures under `test/fixtures/concepts/`

**Interfaces:**
- Consumes: `ContentError`.
- Produces:
  - `interface ConceptSpec { id, title, rhel, objectives, sources, prerequisites, body, path }`
  - `function parseConcept(text: string, path: string): ConceptSpec`
  - `function loadConcept(path: string): Promise<ConceptSpec>`

- [ ] **Step 1: Write the failing test**

Fixture `test/fixtures/concepts/good.md`:

```markdown
---
id: storage.lvm-abstraction-stack
title: Physical volumes, volume groups, logical volumes
rhel: 9
objectives: [storage.lvm.create, storage.lvm.resize]
sources: [r9:ch15, r10:ch15]
prerequisites: [storage.partitions]
---
LVM inserts two layers between a disk and a filesystem. A **physical volume**
is a whole disk or partition handed over to LVM. A **volume group** pools one
or more physical volumes into a single allocation space. A **logical volume**
is carved out of that pool and is what you actually format and mount.

The point of the pool is that a logical volume need not be contiguous, and
need not live on one disk. That is why growing a filesystem is normally a
two-step job: grow the logical volume, then grow the filesystem inside it.
```

Fixture `test/fixtures/concepts/bad.md`:

```markdown
---
id: Storage.Bad Id
rhel: 11
objectives: "not-a-list"
---
```

`test/content/concept.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ContentError } from '../../src/engine/content/errors.ts'
import { loadConcept } from '../../src/engine/content/concept.ts'

const FIXTURES = new URL('../fixtures/concepts/', import.meta.url).pathname

describe('loadConcept', () => {
  it('parses front matter and keeps the body prose', async () => {
    const c = await loadConcept(`${FIXTURES}good.md`)

    expect(c.id).toBe('storage.lvm-abstraction-stack')
    expect(c.title).toBe('Physical volumes, volume groups, logical volumes')
    expect(c.rhel).toBe(9)
    expect(c.objectives).toEqual(['storage.lvm.create', 'storage.lvm.resize'])
    expect(c.sources).toEqual(['r9:ch15', 'r10:ch15'])
    expect(c.prerequisites).toEqual(['storage.partitions'])
    expect(c.body).toContain('two-step job')
    expect(c.path).toBe(`${FIXTURES}good.md`)
  })

  it('defaults sources and prerequisites to empty', async () => {
    const c = await loadConcept(`${FIXTURES}minimal.md`)
    expect(c.sources).toEqual([])
    expect(c.prerequisites).toEqual([])
  })

  it('rejects an empty body, because a concept card with no prose teaches nothing', async () => {
    const err = (await loadConcept(`${FIXTURES}bad.md`).catch((e: unknown) => e)) as ContentError
    expect(err).toBeInstanceOf(ContentError)
    expect(err.problems.join('\n')).toMatch(/body must be at least/)
  })

  it('reports id, title, rhel and objectives problems together', async () => {
    const err = (await loadConcept(`${FIXTURES}bad.md`).catch((e: unknown) => e)) as ContentError
    const p = err.problems.join('\n')
    expect(p).toMatch(/id must be dotted lowercase/)
    expect(p).toMatch(/title/)
    expect(p).toMatch(/rhel must be an integer 9-10/)
    expect(p).toMatch(/objectives must be a list of strings/)
  })
})
```

Fixture `test/fixtures/concepts/minimal.md`:

```markdown
---
id: systemd.enabled-versus-started
title: Enabled and started are different things
rhel: 9
objectives: [systemd.services.manage]
---
`systemctl start` runs a unit now. `systemctl enable` creates the symlink that
makes it run at boot. Neither implies the other, so a service can be running
and still be absent after a reboot — which is precisely what the exam checks,
because the exam reboots before grading.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/content/concept.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/content/concept.ts'`.

- [ ] **Step 3: Write the implementation**

`src/engine/content/concept.ts`:

```ts
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

export function parseConcept(text: string, path: string): ConceptSpec {
  const problems: string[] = []
  const parsed = matter(text)
  const fm = parsed.data as Record<string, unknown>

  const id = typeof fm.id === 'string' && CONCEPT_ID_RE.test(fm.id) ? fm.id : ''
  if (!id) problems.push('id must be dotted lowercase, e.g. storage.lvm-abstraction-stack')

  const title = typeof fm.title === 'string' && fm.title.trim() !== '' ? fm.title : ''
  if (!title) problems.push('title must be a non-empty string')

  const rhel = typeof fm.rhel === 'number' && (fm.rhel === 9 || fm.rhel === 10) ? fm.rhel : 9
  if (rhel !== fm.rhel) problems.push('rhel must be an integer 9-10')

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 4 new tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/engine/content/concept.ts test/content/concept.test.ts test/fixtures/concepts && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(content): add ConceptSpec loader with a body-length floor

The floor exists because an empty concept card is the one failure mode that
silently breaks the app's promise to replace the book (risk R7)."
```

---

### Task 5: Verdict parser (JSONL → checkpoints)

**Files:**
- Create: `src/engine/grading/verdict.ts`
- Test: `test/grading/verdict.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type CheckpointStatus = 'pass' | 'fail' | 'skip'`
  - `interface Checkpoint { id: string; desc: string; status: CheckpointStatus; detail?: string; weight?: number }`
  - `interface Verdict { checkpoints: Checkpoint[]; noise: string[] }`
  - `function parseVerdict(stdout: string): Verdict`
  - `function duplicateIds(v: Verdict): string[]`
  - `function allPassed(v: Verdict): boolean`
  - `function statusById(v: Verdict): Map<string, CheckpointStatus>`

- [ ] **Step 1: Write the failing test**

`test/grading/verdict.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  allPassed,
  duplicateIds,
  parseVerdict,
  statusById,
} from '../../src/engine/grading/verdict.ts'

describe('parseVerdict', () => {
  it('parses one checkpoint per line', () => {
    const v = parseVerdict(
      [
        '{"id":"lv-var-size","desc":"var LV is >= 6G","status":"pass"}',
        '{"id":"persist-config","desc":"/var mounts at boot","status":"fail","detail":"no entry found"}',
      ].join('\n'),
    )

    expect(v.checkpoints).toHaveLength(2)
    expect(v.checkpoints[0]).toEqual({
      id: 'lv-var-size',
      desc: 'var LV is >= 6G',
      status: 'pass',
    })
    expect(v.checkpoints[1]?.detail).toBe('no entry found')
    expect(v.noise).toEqual([])
  })

  it('keeps non-JSON output as noise instead of throwing', () => {
    // Real graders leak stderr and tool chatter. Losing that output would make
    // a misbehaving grader impossible to debug; throwing would make one stray
    // warning destroy an otherwise valid grading run.
    const v = parseVerdict(
      [
        '  WARNING: device /dev/sdb not found',
        '{"id":"a","desc":"A","status":"pass"}',
        '',
        'not json at all',
      ].join('\n'),
    )

    expect(v.checkpoints).toHaveLength(1)
    expect(v.noise).toEqual(['WARNING: device /dev/sdb not found', 'not json at all'])
  })

  it('treats JSON that is not a checkpoint as noise', () => {
    const v = parseVerdict('{"unrelated":true}\n[1,2,3]')
    expect(v.checkpoints).toEqual([])
    expect(v.noise).toHaveLength(2)
  })

  it('rejects an unknown status as noise rather than inventing a verdict', () => {
    const v = parseVerdict('{"id":"a","desc":"A","status":"probably"}')
    expect(v.checkpoints).toEqual([])
    expect(v.noise).toHaveLength(1)
  })

  it('carries an optional numeric weight through', () => {
    const v = parseVerdict('{"id":"a","desc":"A","status":"pass","weight":3}')
    expect(v.checkpoints[0]?.weight).toBe(3)
  })
})

describe('duplicateIds', () => {
  it('finds repeated checkpoint ids', () => {
    const v = parseVerdict(
      [
        '{"id":"a","desc":"A","status":"pass"}',
        '{"id":"a","desc":"A again","status":"fail"}',
        '{"id":"b","desc":"B","status":"pass"}',
      ].join('\n'),
    )
    // Kept, not thrown: a duplicate is a grader authoring bug for `validate`
    // to catch, and blowing up mid-session would punish the user for it.
    expect(v.checkpoints).toHaveLength(3)
    expect(duplicateIds(v)).toEqual(['a'])
  })

  it('returns empty when ids are unique', () => {
    expect(duplicateIds(parseVerdict('{"id":"a","desc":"A","status":"pass"}'))).toEqual([])
  })
})

describe('allPassed', () => {
  it('is false when any checkpoint failed', () => {
    const v = parseVerdict(
      '{"id":"a","desc":"A","status":"pass"}\n{"id":"b","desc":"B","status":"fail"}',
    )
    expect(allPassed(v)).toBe(false)
  })

  it('treats skip as not-a-pass so a skipped check cannot fake success', () => {
    const v = parseVerdict('{"id":"a","desc":"A","status":"skip"}')
    expect(allPassed(v)).toBe(false)
  })

  it('is false for an empty verdict, because a grader that emitted nothing is broken', () => {
    expect(allPassed(parseVerdict(''))).toBe(false)
  })

  it('is true only when every checkpoint passed', () => {
    const v = parseVerdict(
      '{"id":"a","desc":"A","status":"pass"}\n{"id":"b","desc":"B","status":"pass"}',
    )
    expect(allPassed(v)).toBe(true)
  })
})

describe('statusById', () => {
  it('indexes statuses for comparison between verdict A and B', () => {
    const v = parseVerdict(
      '{"id":"a","desc":"A","status":"pass"}\n{"id":"b","desc":"B","status":"fail"}',
    )
    expect(statusById(v).get('a')).toBe('pass')
    expect(statusById(v).get('b')).toBe('fail')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/grading/verdict.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/grading/verdict.ts'`.

- [ ] **Step 3: Write the implementation**

`src/engine/grading/verdict.ts`:

```ts
export type CheckpointStatus = 'pass' | 'fail' | 'skip'

export interface Checkpoint {
  id: string
  desc: string
  status: CheckpointStatus
  detail?: string
  weight?: number
}

export interface Verdict {
  checkpoints: Checkpoint[]
  /** Lines that were not valid checkpoints. Kept for debugging graders. */
  noise: string[]
}

const STATUSES: readonly string[] = ['pass', 'fail', 'skip']

function asCheckpoint(v: unknown): Checkpoint | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || o.id === '') return undefined
  if (typeof o.desc !== 'string') return undefined
  if (typeof o.status !== 'string' || !STATUSES.includes(o.status)) return undefined

  const cp: Checkpoint = { id: o.id, desc: o.desc, status: o.status as CheckpointStatus }
  if (typeof o.detail === 'string') cp.detail = o.detail
  if (typeof o.weight === 'number') cp.weight = o.weight
  return cp
}

/**
 * Parse a grader's stdout. Never throws: graders are shell scripts on a real
 * machine and will emit stray warnings, so unparseable lines are collected as
 * noise rather than allowed to destroy a valid grading run.
 */
export function parseVerdict(stdout: string): Verdict {
  const checkpoints: Checkpoint[] = []
  const noise: string[] = []

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      noise.push(line)
      continue
    }

    const cp = asCheckpoint(parsed)
    if (cp) checkpoints.push(cp)
    else noise.push(line)
  }

  return { checkpoints, noise }
}

/** Checkpoint ids emitted more than once. A grader authoring bug. */
export function duplicateIds(v: Verdict): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const cp of v.checkpoints) {
    if (seen.has(cp.id)) dupes.add(cp.id)
    seen.add(cp.id)
  }
  return [...dupes]
}

/**
 * True only when there is at least one checkpoint and every one passed.
 * `skip` deliberately does not count as a pass: a grader that skips its way
 * to green is the false-positive failure mode the spec cares most about.
 */
export function allPassed(v: Verdict): boolean {
  return v.checkpoints.length > 0 && v.checkpoints.every((cp) => cp.status === 'pass')
}

export function statusById(v: Verdict): Map<string, CheckpointStatus> {
  return new Map(v.checkpoints.map((cp) => [cp.id, cp.status]))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 12 new tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/engine/grading test/grading && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(grading): parse grader JSONL into verdicts

Unparseable lines become noise rather than exceptions, so one stray shell
warning cannot destroy a valid grading run. skip does not count as a pass,
which closes the cheapest route to a false positive."
```

---

### Task 6: Objectives taxonomy loader

**Files:**
- Create: `src/engine/content/objectives.ts`
- Test: `test/content/objectives.test.ts`, fixture `test/fixtures/objectives-good.yaml`

**Interfaces:**
- Consumes: `ContentError`.
- Produces:
  - `interface Objective { id: string; text: string; chapters: number[] }`
  - `interface ObjectiveSet { version: string; source: string; objectives: Objective[]; byId: Map<string, Objective> }`
  - `function parseObjectives(raw: unknown, where: string): ObjectiveSet`
  - `function loadObjectives(path: string): Promise<ObjectiveSet>`

- [ ] **Step 1: Write the failing test**

Fixture `test/fixtures/objectives-good.yaml`:

```yaml
version: rhel9
source: "RHCSA 9 Cert Guide objective mapping table, p.38"
objectives:
  - id: storage.lvm.resize
    text: Extend existing logical volumes
    chapters: [15]
  - id: storage.fs.xfs
    text: Create, mount, unmount and use XFS filesystems
    chapters: [14, 15]
  - id: users.local.create
    text: Create, delete and modify local user accounts
    chapters: [6]
```

`test/content/objectives.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ContentError } from '../../src/engine/content/errors.ts'
import { loadObjectives, parseObjectives } from '../../src/engine/content/objectives.ts'

const FIXTURES = new URL('../fixtures/', import.meta.url).pathname

describe('loadObjectives', () => {
  it('loads and indexes objectives by id', async () => {
    const set = await loadObjectives(`${FIXTURES}objectives-good.yaml`)

    expect(set.version).toBe('rhel9')
    expect(set.source).toMatch(/p\.38/)
    expect(set.objectives).toHaveLength(3)
    expect(set.byId.get('storage.fs.xfs')?.chapters).toEqual([14, 15])
    expect(set.byId.has('users.local.create')).toBe(true)
  })
})

describe('parseObjectives', () => {
  it('rejects a duplicate objective id', () => {
    const raw = {
      version: 'rhel9',
      source: 'x',
      objectives: [
        { id: 'a.b', text: 'A', chapters: [1] },
        { id: 'a.b', text: 'A again', chapters: [2] },
      ],
    }
    const err = (() => {
      try {
        parseObjectives(raw, 'inline')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError

    expect(err).toBeInstanceOf(ContentError)
    expect(err.problems.join('\n')).toMatch(/duplicate objective id: a\.b/)
  })

  it('rejects a malformed id, empty text, and a bad chapter', () => {
    const raw = {
      version: 'rhel9',
      source: 'x',
      objectives: [{ id: 'NotDotted', text: '', chapters: [99] }],
    }
    const err = (() => {
      try {
        parseObjectives(raw, 'inline')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError

    const p = err.problems.join('\n')
    expect(p).toMatch(/id must be dotted lowercase/)
    expect(p).toMatch(/text must be non-empty/)
    expect(p).toMatch(/chapters must be integers 1-28/)
  })

  it('requires version and a non-empty objective list', () => {
    const err = (() => {
      try {
        parseObjectives({ objectives: [] }, 'inline')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError

    const p = err.problems.join('\n')
    expect(p).toMatch(/version/)
    expect(p).toMatch(/source/)
    expect(p).toMatch(/at least one objective/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/content/objectives.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/content/objectives.ts'`.

- [ ] **Step 3: Write the implementation**

`src/engine/content/objectives.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { load } from 'js-yaml'
import { ContentError } from './errors.ts'

export interface Objective {
  id: string
  text: string
  chapters: number[]
}

export interface ObjectiveSet {
  version: string
  source: string
  objectives: Objective[]
  byId: Map<string, Objective>
}

const OBJECTIVE_ID_RE = /^[a-z0-9]+(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function parseObjectives(raw: unknown, where: string): ObjectiveSet {
  const problems: string[] = []

  if (!isRecord(raw)) throw new ContentError(where, ['file must contain a YAML mapping'])

  const version = typeof raw.version === 'string' && raw.version !== '' ? raw.version : ''
  if (!version) problems.push('version must be a non-empty string, e.g. rhel9')

  const source = typeof raw.source === 'string' && raw.source !== '' ? raw.source : ''
  if (!source) problems.push('source must cite where the taxonomy was transcribed from')

  const list = Array.isArray(raw.objectives) ? raw.objectives : []
  if (list.length === 0) problems.push('objectives must list at least one objective')

  const objectives: Objective[] = []
  const seen = new Set<string>()

  for (const [i, entry] of list.entries()) {
    if (!isRecord(entry)) {
      problems.push(`objectives[${i}] must be a mapping`)
      continue
    }

    const id = typeof entry.id === 'string' && OBJECTIVE_ID_RE.test(entry.id) ? entry.id : ''
    if (!id) {
      problems.push(`objectives[${i}].id must be dotted lowercase, e.g. storage.lvm.resize`)
    } else if (seen.has(id)) {
      problems.push(`duplicate objective id: ${id}`)
    }
    if (id) seen.add(id)

    const text = typeof entry.text === 'string' && entry.text.trim() !== '' ? entry.text : ''
    if (!text) problems.push(`objectives[${i}].text must be non-empty`)

    const rawChapters = Array.isArray(entry.chapters) ? entry.chapters : []
    const bad = rawChapters.some(
      (c) => typeof c !== 'number' || !Number.isInteger(c) || c < 1 || c > 28,
    )
    if (rawChapters.length === 0 || bad) {
      problems.push(`objectives[${i}].chapters must be integers 1-28, at least one`)
    }

    objectives.push({ id, text, chapters: bad ? [] : (rawChapters as number[]) })
  }

  if (problems.length > 0) throw new ContentError(where, problems)

  return {
    version,
    source,
    objectives,
    byId: new Map(objectives.map((o) => [o.id, o])),
  }
}

export async function loadObjectives(path: string): Promise<ObjectiveSet> {
  return parseObjectives(load(await readFile(path, 'utf8')), path)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 4 new tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/engine/content/objectives.ts test/content/objectives.test.ts test/fixtures/objectives-good.yaml && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(content): add objectives taxonomy loader

A required source field forces every taxonomy to cite where it was
transcribed from, since these tables are images in both editions and must be
read visually rather than extracted."
```

---

### Task 7: Content bank loader and coverage report

**Files:**
- Create: `src/engine/content/bank.ts`
- Test: `test/content/bank.test.ts`, fixture tree under `test/fixtures/bank/`

**Interfaces:**
- Consumes: `loadTask`/`TaskSpec` (T3), `loadConcept`/`ConceptSpec` (T4), `loadObjectives`/`ObjectiveSet` (T6), `ContentError` (T2).
- Produces:
  - `interface Bank { root, objectives, tasks, concepts, tasksById, conceptsById }`
  - `interface CoverageReport { problems: string[]; untaughtConcepts: string[]; uncoveredObjectives: string[] }`
  - `function loadBank(root: string): Promise<Bank>`
  - `function checkCoverage(bank: Bank): CoverageReport`

**Design note — why coverage gaps are not errors yet.** Spec §8 lists "every objective has at least one task" as an assertion. Taken literally in Phase 1 that makes `validate` fail permanently, because Phase 1 authors five tasks against a taxonomy of dozens of objectives. So `problems` holds only *unresolvable references* (a genuine authoring bug), while gaps are returned as counted lists for the Dashboard to surface. Task 12 wires a `--strict` flag that promotes gaps to failures, for use once the bank is complete.

- [ ] **Step 1: Create the fixture tree**

```bash
cd /home/daxtangco/rhcsa-trainer
mkdir -p test/fixtures/bank/tasks/storage/014-grow-var \
         test/fixtures/bank/tasks/users/001-create-account \
         test/fixtures/bank/concepts/storage
```

`test/fixtures/bank/objectives.yaml`:

```yaml
version: rhel9
source: "test fixture"
objectives:
  - id: storage.lvm.resize
    text: Extend existing logical volumes
    chapters: [15]
  - id: users.local.create
    text: Create, delete and modify local user accounts
    chapters: [6]
  - id: autofs.maps.configure
    text: Configure autofs
    chapters: [16]
```

`test/fixtures/bank/tasks/storage/014-grow-var/task.yaml`:

```yaml
id: storage/014-grow-var
title: Grow the var logical volume
chapter: 15
scope: exam-objective
rhel: 9
objectives: [storage.lvm.resize]
requires_concepts: [storage.lvm-abstraction-stack]
difficulty: 3
time_budget: 480
weight: high
prompt: |
  Grow the var logical volume to at least 6 GB.
```

`test/fixtures/bank/tasks/users/001-create-account/task.yaml`:

```yaml
id: users/001-create-account
title: Create a user account
chapter: 6
scope: exam-objective
rhel: 9
objectives: [users.local.create]
difficulty: 1
time_budget: 120
weight: medium
prompt: |
  Create a user named alice.
```

`test/fixtures/bank/concepts/storage/lvm-abstraction-stack.md`:

```markdown
---
id: storage.lvm-abstraction-stack
title: Physical volumes, volume groups, logical volumes
rhel: 9
objectives: [storage.lvm.resize]
---
LVM inserts two layers between a disk and a filesystem: a physical volume is a
disk handed to LVM, a volume group pools physical volumes, and a logical volume
is carved out of that pool. Growing a filesystem is therefore a two-step job.
```

`test/fixtures/bank/concepts/storage/orphan.md`:

```markdown
---
id: storage.orphan-concept
title: A concept no task requires
rhel: 9
objectives: [storage.lvm.resize]
---
This card exists to prove that checkCoverage notices concepts which no task
ever pulls in, because an unreferenced card is one the user will never be shown
and therefore silently fails the promise to replace the book.
```

- [ ] **Step 2: Write the failing test**

`test/content/bank.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { checkCoverage, loadBank } from '../../src/engine/content/bank.ts'
import { ContentError } from '../../src/engine/content/errors.ts'

const BANK = new URL('../fixtures/bank', import.meta.url).pathname

describe('loadBank', () => {
  it('discovers tasks and concepts recursively and indexes them', async () => {
    const bank = await loadBank(BANK)

    expect(bank.tasks.map((t) => t.id).sort()).toEqual([
      'storage/014-grow-var',
      'users/001-create-account',
    ])
    expect(bank.concepts.map((c) => c.id).sort()).toEqual([
      'storage.lvm-abstraction-stack',
      'storage.orphan-concept',
    ])
    expect(bank.tasksById.get('users/001-create-account')?.chapter).toBe(6)
    expect(bank.conceptsById.get('storage.lvm-abstraction-stack')?.title).toMatch(/Physical/)
    expect(bank.objectives.byId.size).toBe(3)
  })
})

describe('checkCoverage', () => {
  it('reports no problems when every reference resolves', async () => {
    const report = checkCoverage(await loadBank(BANK))
    expect(report.problems).toEqual([])
  })

  it('lists concepts that no task requires', async () => {
    const report = checkCoverage(await loadBank(BANK))
    // Unreferenced cards can never be shown, so they are tracked separately
    // from hard errors rather than ignored.
    expect(report.untaughtConcepts).toEqual(['storage.orphan-concept'])
  })

  it('lists objectives with no exam-objective task', async () => {
    const report = checkCoverage(await loadBank(BANK))
    expect(report.uncoveredObjectives).toEqual(['autofs.maps.configure'])
  })

  it('treats an unresolvable requires_concepts entry as a hard problem', async () => {
    const bank = await loadBank(BANK)
    const task = bank.tasksById.get('storage/014-grow-var')
    if (!task) throw new Error('fixture missing')
    task.requiresConcepts = ['storage.does-not-exist']

    const report = checkCoverage(bank)
    expect(report.problems.join('\n')).toMatch(
      /storage\/014-grow-var requires unknown concept: storage\.does-not-exist/,
    )
  })

  it('treats an unknown objective id on a task as a hard problem', async () => {
    const bank = await loadBank(BANK)
    const task = bank.tasksById.get('users/001-create-account')
    if (!task) throw new Error('fixture missing')
    task.objectives = ['users.nope']

    const report = checkCoverage(bank)
    expect(report.problems.join('\n')).toMatch(
      /users\/001-create-account maps to unknown objective: users\.nope/,
    )
  })

  it('treats an unresolvable concept prerequisite as a hard problem', async () => {
    const bank = await loadBank(BANK)
    const concept = bank.conceptsById.get('storage.lvm-abstraction-stack')
    if (!concept) throw new Error('fixture missing')
    concept.prerequisites = ['storage.nope']

    const report = checkCoverage(bank)
    expect(report.problems.join('\n')).toMatch(
      /storage\.lvm-abstraction-stack lists unknown prerequisite: storage\.nope/,
    )
  })

  it('excludes instrumental tasks from objective coverage', async () => {
    // Chapter 21 Apache teaches SELinux and firewalld through a non-objective
    // service. It must not be able to claim coverage of an objective on its own.
    const bank = await loadBank(BANK)
    const task = bank.tasksById.get('storage/014-grow-var')
    if (!task) throw new Error('fixture missing')
    task.scope = 'instrumental'

    const report = checkCoverage(bank)
    expect(report.uncoveredObjectives.sort()).toEqual([
      'autofs.maps.configure',
      'storage.lvm.resize',
    ])
  })
})

describe('loadBank duplicate detection', () => {
  it('rejects two tasks declaring the same id', async () => {
    const err = await loadBank(
      new URL('../fixtures/bank-dupe', import.meta.url).pathname,
    ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ContentError)
    expect((err as ContentError).problems.join('\n')).toMatch(/duplicate task id/)
  })
})
```

Create the duplicate fixture:

```bash
cd /home/daxtangco/rhcsa-trainer
mkdir -p test/fixtures/bank-dupe/tasks/a/001-x test/fixtures/bank-dupe/tasks/b/001-x \
         test/fixtures/bank-dupe/concepts
cp test/fixtures/bank/objectives.yaml test/fixtures/bank-dupe/objectives.yaml
for d in a b; do
  cat > "test/fixtures/bank-dupe/tasks/$d/001-x/task.yaml" <<'YAML'
id: users/001-create-account
title: Duplicated on purpose
chapter: 6
scope: exam-objective
rhel: 9
objectives: [users.local.create]
difficulty: 1
time_budget: 120
weight: medium
prompt: |
  Create a user named alice.
YAML
done
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/content/bank.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/content/bank.ts'`.

- [ ] **Step 4: Write the implementation**

`src/engine/content/bank.ts`:

```ts
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

async function findFiles(root: string, filename: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => [])
  return entries
    .filter((e) => e.isFile() && e.name === filename)
    .map((e) => join(e.parentPath, e.name))
}

async function findMarkdown(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => [])
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => join(e.parentPath, e.name))
    .sort()
}

export async function loadBank(root: string): Promise<Bank> {
  const objectives = await loadObjectives(join(root, 'objectives.yaml'))

  const taskFiles = (await findFiles(join(root, 'tasks'), 'task.yaml')).sort()
  const tasks = await Promise.all(taskFiles.map((f) => loadTask(dirname(f))))

  const conceptFiles = await findMarkdown(join(root, 'concepts'))
  const concepts = await Promise.all(conceptFiles.map((f) => loadConcept(f)))

  const problems: string[] = []
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

  if (problems.length > 0) throw new ContentError(root, problems)

  return { root, objectives, tasks, concepts, tasksById, conceptsById }
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 9 new tests PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/engine/content/bank.ts test/content/bank.test.ts test/fixtures/bank test/fixtures/bank-dupe && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(content): load the bank and report coverage

Unresolvable references are hard problems; coverage gaps are counted lists.
Making gaps errors would fail validate permanently in Phase 1, when five tasks
exist against a taxonomy of dozens. Instrumental tasks cannot claim objective
coverage on their own, per spec section 6.4."
```

---

### Task 8: Grading sequence with the reboot check

The highest-value output in the system (spec §5.4): the pass → fail transition that identifies a persistence failure.

**Files:**
- Create: `src/engine/grading/grader.ts`
- Test: `test/grading/grader.test.ts`

**Interfaces:**
- Consumes: `LabTransport` (T2), `TaskSpec` (T3), `parseVerdict`/`Verdict`/`Checkpoint`/`statusById` (T5).
- Produces:
  - `interface GradeOptions { task: TaskSpec; transport: LabTransport; gradeScript: string; reboot: () => Promise<void> }`
  - `interface GradeResult { verdictA: Verdict; verdictB?: Verdict; regressions: Checkpoint[]; rebooted: boolean; rebootError?: string }`
  - `function grade(opts: GradeOptions): Promise<GradeResult>`
  - `function finalVerdict(r: GradeResult): Verdict`

**Design note — why `reboot` is injected.** The grading sequence is pure orchestration logic and is the part most worth testing exhaustively. Passing the reboot as a function keeps it decoupled from `VmController` (T17), so every branch — including "the VM never came back" — is testable with no hypervisor.

- [ ] **Step 1: Write the failing test**

`test/grading/grader.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { finalVerdict, grade } from '../../src/engine/grading/grader.ts'
import { FakeTransport } from '../../src/engine/vm/fake.ts'
import type { TaskSpec } from '../../src/engine/content/task.ts'

function task(over: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: 'storage/014-grow-var',
    title: 'Grow var',
    chapter: 15,
    scope: 'exam-objective',
    rhel: 9,
    objectives: ['storage.lvm.resize'],
    requiresConcepts: [],
    difficulty: 3,
    timeBudget: 480,
    weight: 'high',
    editions: ['r9'],
    rebootCheck: true,
    requiresDisks: 0,
    claims: [],
    transport: 'ssh',
    prompt: 'Grow var to 6G.',
    dir: '/nowhere',
    ...over,
  }
}

const PASS_PASS = [
  '{"id":"lv-var-size","desc":"var LV >= 6G","status":"pass"}',
  '{"id":"var-from-lv","desc":"/var mounted from the LV","status":"pass"}',
].join('\n')

const PASS_FAIL = [
  '{"id":"lv-var-size","desc":"var LV >= 6G","status":"pass"}',
  '{"id":"var-from-lv","desc":"/var mounted from the LV","status":"fail","detail":"not mounted"}',
].join('\n')

describe('grade', () => {
  it('skips the reboot entirely when the task does not ask for one', async () => {
    const reboot = vi.fn(async () => {})
    const t = new FakeTransport(() => ({ stdout: PASS_PASS, stderr: '', code: 0 }))

    const r = await grade({
      task: task({ rebootCheck: false }),
      transport: t,
      gradeScript: 'grade',
      reboot,
    })

    expect(reboot).not.toHaveBeenCalled()
    expect(r.rebooted).toBe(false)
    expect(r.verdictB).toBeUndefined()
    expect(r.regressions).toEqual([])
    expect(t.calls).toHaveLength(1)
  })

  it('skips the reboot when nothing passed, because there is nothing to persist', async () => {
    const reboot = vi.fn(async () => {})
    const allFail = '{"id":"lv-var-size","desc":"var LV >= 6G","status":"fail"}'
    const t = new FakeTransport(() => ({ stdout: allFail, stderr: '', code: 0 }))

    const r = await grade({ task: task(), transport: t, gradeScript: 'grade', reboot })

    expect(reboot).not.toHaveBeenCalled()
    expect(r.verdictB).toBeUndefined()
  })

  it('reboots and grades again when reboot_check is set and something passed', async () => {
    const reboot = vi.fn(async () => {})
    let rebooted = false
    const t = new FakeTransport(() => ({
      stdout: rebooted ? PASS_FAIL : PASS_PASS,
      stderr: '',
      code: 0,
    }))
    reboot.mockImplementation(async () => {
      rebooted = true
    })

    const r = await grade({ task: task(), transport: t, gradeScript: 'grade', reboot })

    expect(reboot).toHaveBeenCalledTimes(1)
    expect(r.rebooted).toBe(true)
    expect(t.calls).toHaveLength(2)
    expect(r.verdictB?.checkpoints).toHaveLength(2)
  })

  it('names the pass-to-fail checkpoints as regressions', async () => {
    let rebooted = false
    const t = new FakeTransport(() => ({
      stdout: rebooted ? PASS_FAIL : PASS_PASS,
      stderr: '',
      code: 0,
    }))

    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {
        rebooted = true
      },
    })

    expect(r.regressions.map((c) => c.id)).toEqual(['var-from-lv'])
    expect(r.regressions[0]?.detail).toBe('not mounted')
  })

  it('does not count an already-failing checkpoint as a regression', async () => {
    const t = new FakeTransport(() => ({ stdout: PASS_FAIL, stderr: '', code: 0 }))
    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {},
    })
    expect(r.regressions).toEqual([])
  })

  it('records a reboot failure as a result rather than throwing', async () => {
    // The user broke boot. That is itself a finding, not a crash.
    const t = new FakeTransport(() => ({ stdout: PASS_PASS, stderr: '', code: 0 }))
    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {
        throw new Error('timed out waiting for SSH after 120s')
      },
    })

    expect(r.rebooted).toBe(false)
    expect(r.rebootError).toMatch(/timed out waiting for SSH/)
    expect(r.verdictB).toBeUndefined()
    expect(r.verdictA.checkpoints).toHaveLength(2)
  })

  it('ignores the grader exit code', async () => {
    // Spec section 6.5 rule 3: one failing check must not abort the rest, so a
    // non-zero exit is normal and must not be treated as an error.
    const t = new FakeTransport(() => ({ stdout: PASS_FAIL, stderr: 'lvs: warning', code: 1 }))
    const r = await grade({
      task: task({ rebootCheck: false }),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {},
    })
    expect(r.verdictA.checkpoints).toHaveLength(2)
  })
})

describe('finalVerdict', () => {
  it('returns verdict B when a reboot happened, because B is the real answer', async () => {
    let rebooted = false
    const t = new FakeTransport(() => ({
      stdout: rebooted ? PASS_FAIL : PASS_PASS,
      stderr: '',
      code: 0,
    }))
    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {
        rebooted = true
      },
    })
    expect(finalVerdict(r)).toBe(r.verdictB)
  })

  it('falls back to verdict A when no reboot happened', async () => {
    const t = new FakeTransport(() => ({ stdout: PASS_PASS, stderr: '', code: 0 }))
    const r = await grade({
      task: task({ rebootCheck: false }),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {},
    })
    expect(finalVerdict(r)).toBe(r.verdictA)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/grading/grader.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/grading/grader.ts'`.

- [ ] **Step 3: Write the implementation**

`src/engine/grading/grader.ts`:

```ts
import type { TaskSpec } from '../content/task.ts'
import type { LabTransport } from '../vm/transport.ts'
import { parseVerdict, statusById, type Checkpoint, type Verdict } from './verdict.ts'

export interface GradeOptions {
  task: TaskSpec
  transport: LabTransport
  /** Full text of grade.sh, with the assertion library prepended. */
  gradeScript: string
  /** Reboots the guest and resolves once it is reachable again. */
  reboot: () => Promise<void>
}

export interface GradeResult {
  /** "Works now". */
  verdictA: Verdict
  /** "Survives reboot". Absent when no reboot was performed. */
  verdictB?: Verdict
  /** Checkpoints that passed in A and failed in B: persistence failures. */
  regressions: Checkpoint[]
  rebooted: boolean
  /** Set when the VM did not come back. The user broke boot. */
  rebootError?: string
}

/** The verdict that actually counts: B when there was a reboot, else A. */
export function finalVerdict(r: GradeResult): Verdict {
  return r.verdictB ?? r.verdictA
}

export async function grade(opts: GradeOptions): Promise<GradeResult> {
  const { task, transport, gradeScript, reboot } = opts

  // Exit code is deliberately ignored (spec section 6.5 rule 3).
  const runA = await transport.exec(gradeScript)
  const verdictA = parseVerdict(runA.stdout)

  const anythingPassed = verdictA.checkpoints.some((cp) => cp.status === 'pass')

  // No point rebooting to test persistence of work that was never done.
  if (!task.rebootCheck || !anythingPassed) {
    return { verdictA, regressions: [], rebooted: false }
  }

  try {
    await reboot()
  } catch (e) {
    return {
      verdictA,
      regressions: [],
      rebooted: false,
      rebootError: e instanceof Error ? e.message : String(e),
    }
  }

  const runB = await transport.exec(gradeScript)
  const verdictB = parseVerdict(runB.stdout)

  const before = statusById(verdictA)
  const regressions = verdictB.checkpoints.filter(
    (cp) => cp.status === 'fail' && before.get(cp.id) === 'pass',
  )

  return { verdictA, verdictB, regressions, rebooted: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 9 new tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/engine/grading/grader.ts test/grading/grader.test.ts && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(grading): add the verdict A/B sequence and regression detection

Injecting reboot as a function keeps every branch testable without a
hypervisor, including the case where the VM never returns - which is a result
about the user's work, not an exception."
```

---

### Task 9: Disclosure ladder and FSRS rating

**Files:**
- Create: `src/engine/disclosure/ladder.ts`, `src/engine/exam/limits.ts`
- Test: `test/disclosure/ladder.test.ts`, `test/exam/limits.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type LadderMode = 'practice' | 'drill' | 'exam'` — note `guided` is deliberately absent
  - `type Rung = 1 | 2 | 3 | 4 | 5`
  - `const MAX_RUNG: Record<LadderMode, Rung>`
  - `interface LadderState { mode: LadderMode; rung: Rung }`
  - `function startLadder(mode: LadderMode): LadderState`
  - `function canAdvance(s: LadderState): boolean`
  - `function advance(s: LadderState): LadderState`
  - `type Rating = 'again' | 'hard' | 'good' | 'easy'`
  - `interface RatingInput { rungUsed: Rung; passed: boolean; anyPassed: boolean; durationS: number; timeBudgetS: number; hadRegression: boolean }`
  - `function deriveRating(i: RatingInput): Rating`
  - `const EXAM_DURATION_MINUTES`, `const EXAM_TOTAL_SCORE`, `const EXAM_PASSING_SCORE` from `src/engine/exam/limits.ts`

**Design note.** `LadderMode` excludes `guided` on purpose. Spec §7 marks guided mode's max rung "n/a" because guided mode *is* full disclosure by construction, so the type system refuses to represent a ladder in guided mode rather than encoding it as a magic number.

- [ ] **Step 1: Write the failing test**

`test/disclosure/ladder.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  advance,
  canAdvance,
  deriveRating,
  MAX_RUNG,
  startLadder,
  type RatingInput,
} from '../../src/engine/disclosure/ladder.ts'

describe('MAX_RUNG', () => {
  it('caps each mode per spec section 7', () => {
    expect(MAX_RUNG.practice).toBe(5)
    expect(MAX_RUNG.drill).toBe(3)
    expect(MAX_RUNG.exam).toBe(2)
  })
})

describe('ladder navigation', () => {
  it('starts cold at rung 1', () => {
    expect(startLadder('practice')).toEqual({ mode: 'practice', rung: 1 })
  })

  it('advances one rung at a time and does not mutate the input', () => {
    const a = startLadder('practice')
    const b = advance(a)
    expect(b.rung).toBe(2)
    expect(a.rung).toBe(1)
  })

  it('stops drill at the concept card', () => {
    // Concept cards stay available because a forgotten concept is what drill
    // exists to catch, but command assembly must be unaided.
    let s = startLadder('drill')
    s = advance(s)
    s = advance(s)
    expect(s.rung).toBe(3)
    expect(canAdvance(s)).toBe(false)
    expect(() => advance(s)).toThrow(/rung 3 is the maximum in drill mode/)
  })

  it('stops exam mode at the nudge', () => {
    const s = advance(startLadder('exam'))
    expect(s.rung).toBe(2)
    expect(canAdvance(s)).toBe(false)
    expect(() => advance(s)).toThrow(/rung 2 is the maximum in exam mode/)
  })

  it('allows the full ladder in practice mode', () => {
    let s = startLadder('practice')
    for (let i = 0; i < 4; i++) s = advance(s)
    expect(s.rung).toBe(5)
    expect(canAdvance(s)).toBe(false)
  })
})

describe('deriveRating', () => {
  const base: RatingInput = {
    rungUsed: 1,
    passed: true,
    anyPassed: true,
    durationS: 300,
    timeBudgetS: 480,
    hadRegression: false,
  }

  it('gives easy for solving cold inside the time budget', () => {
    expect(deriveRating(base)).toBe('easy')
  })

  it('gives good for solving cold but over budget', () => {
    expect(deriveRating({ ...base, durationS: 900 })).toBe('good')
  })

  it('gives good when only a nudge was needed', () => {
    expect(deriveRating({ ...base, rungUsed: 2 })).toBe('good')
  })

  it('gives hard when the concept card was needed', () => {
    expect(deriveRating({ ...base, rungUsed: 3 })).toBe('hard')
  })

  it('gives hard for a partial pass', () => {
    expect(deriveRating({ ...base, passed: false, anyPassed: true })).toBe('hard')
  })

  it('gives again when nothing passed', () => {
    expect(deriveRating({ ...base, passed: false, anyPassed: false })).toBe('again')
  })

  it('gives again when the command sketch or full solution was needed', () => {
    expect(deriveRating({ ...base, rungUsed: 4 })).toBe('again')
    expect(deriveRating({ ...base, rungUsed: 5 })).toBe('again')
  })

  it('gives again for any reboot regression, even on an otherwise clean solve', () => {
    // Believing you are finished before making it permanent is the single most
    // common way a competent candidate fails, so it outranks everything else.
    expect(deriveRating({ ...base, hadRegression: true })).toBe('again')
  })

  it('lets a regression outrank a fast cold solve', () => {
    expect(
      deriveRating({ ...base, rungUsed: 1, durationS: 10, hadRegression: true }),
    ).toBe('again')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/disclosure/ladder.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/disclosure/ladder.ts'`.

- [ ] **Step 3: Write the implementation**

`src/engine/disclosure/ladder.ts`:

```ts
/**
 * Guided mode is deliberately not a LadderMode: it is full disclosure by
 * construction (spec section 7), so representing a ladder there is meaningless.
 */
export type LadderMode = 'practice' | 'drill' | 'exam'

export type Rung = 1 | 2 | 3 | 4 | 5

/**
 * 1 cold, 2 nudge, 3 concept card, 4 command sketch, 5 narrated solution.
 */
export const MAX_RUNG: Record<LadderMode, Rung> = {
  practice: 5,
  drill: 3,
  exam: 2,
}

export interface LadderState {
  mode: LadderMode
  rung: Rung
}

export function startLadder(mode: LadderMode): LadderState {
  return { mode, rung: 1 }
}

export function canAdvance(s: LadderState): boolean {
  return s.rung < MAX_RUNG[s.mode]
}

export function advance(s: LadderState): LadderState {
  if (!canAdvance(s)) {
    throw new Error(`rung ${s.rung} is the maximum in ${s.mode} mode`)
  }
  return { mode: s.mode, rung: (s.rung + 1) as Rung }
}

export type Rating = 'again' | 'hard' | 'good' | 'easy'

export interface RatingInput {
  rungUsed: Rung
  /** Every checkpoint passed in the verdict that counts. */
  passed: boolean
  /** At least one checkpoint passed, i.e. the attempt was partial rather than blank. */
  anyPassed: boolean
  durationS: number
  timeBudgetS: number
  /** Any checkpoint went pass to fail across the reboot. */
  hadRegression: boolean
}

/**
 * Ratings are derived, never self-reported (spec section 9.2): self-rating is
 * unreliable and invites gaming. Order matters — the cascade encodes priority.
 */
export function deriveRating(i: RatingInput): Rating {
  // A persistence failure is the most instructive outcome in the system and
  // outranks everything, including an otherwise flawless cold solve.
  if (i.hadRegression) return 'again'
  if (i.rungUsed >= 4) return 'again'
  if (!i.passed && !i.anyPassed) return 'again'
  if (!i.passed) return 'hard'
  if (i.rungUsed === 3) return 'hard'
  if (i.rungUsed <= 1 && i.durationS <= i.timeBudgetS) return 'easy'
  return 'good'
}
```

- [ ] **Step 4: Record the exam parameters in one place**

Spec §16 lists the EX200 duration and passing score as Phase 0 deliverables and §13.2 consumes them, but nothing in Phase 1 enforces them. They still need an owner, and this is the only mode-aware module in Phase 1 — it already encodes the per-mode rung caps — so the constants live beside it. The values are an open Phase-0 blocker for the user to confirm, which is why the comment says so and why there is exactly one file to correct.

`src/engine/exam/limits.ts`:

```ts
/**
 * EX200 exam parameters. UNCONFIRMED — Phase 0 blocker: verify against the
 * current Red Hat exam objectives page before Phase 2 builds exam mode.
 * Nothing in Phase 1 enforces these; they exist so there is exactly one
 * place to correct.
 */
export const EXAM_DURATION_MINUTES = 150
export const EXAM_TOTAL_SCORE = 300
export const EXAM_PASSING_SCORE = 210
```

`test/exam/limits.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { EXAM_PASSING_SCORE, EXAM_TOTAL_SCORE } from '../../src/engine/exam/limits.ts'

describe('exam limits', () => {
  it('keeps the passing score at 70% of the total', () => {
    // The ratio is the invariant worth pinning: it is what survives if Red Hat
    // rescales the exam, whereas either number alone does not.
    expect(EXAM_PASSING_SCORE / EXAM_TOTAL_SCORE).toBe(0.7)
  })
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 16 new tests PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/engine/disclosure src/engine/exam test/disclosure test/exam && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(disclosure): add the five-rung ladder and derived FSRS rating

LadderMode excludes guided so the type system refuses to represent a ladder
where the spec says n/a. A reboot regression outranks every other signal in
deriveRating, because failing to persist is the most common way a competent
candidate loses points."
```

---

### Task 10: Anti-solution expectation headers

Anti-solutions must declare which checkpoints they expect to fail, so the harness can assert *the right check caught the error*. A grader that fails for the wrong reason is still broken.

**Files:**
- Create: `src/engine/validate/expectations.ts`
- Test: `test/validate/expectations.test.ts`

**Interfaces:**
- Consumes: `ContentError` (T2).
- Produces:
  - `type ExpectPhase = 'pre' | 'post' | 'both'`
  - `interface ExpectedFailure { id: string; phase: ExpectPhase }`
  - `function parseExpectations(script: string, where: string): ExpectedFailure[]`
  - `function expectedStatus(declared: ExpectedFailure[], id: string, verdict: 'A' | 'B'): 'pass' | 'fail'`

**The header format.** A comment line in the anti-solution script:

```bash
# expect-fail: fs-var-size, persist-config@post
```

Each entry is `<checkpoint-id>` with an optional `@pre`, `@post`, or `@both` suffix (default `both`).

| Phase | Verdict A | Verdict B | The failure mode it models |
|---|---|---|---|
| `both` | fail | fail | Plainly wrong work — e.g. resized the LV, never grew the filesystem |
| `post` | **pass** | fail | **The persistence signature** — works now, gone after reboot |
| `pre` | fail | pass | Rare; something the reboot repairs |

`post` is the important one and the reason phase is per-checkpoint rather than per-file: an anti-solution that forgets `--permanent` produces a mix of checkpoints, some wrong immediately and some only after the reboot. A per-file phase could not express that, and would let the harness accept a grader that failed at the wrong moment.

- [ ] **Step 1: Write the failing test**

`test/validate/expectations.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ContentError } from '../../src/engine/content/errors.ts'
import { expectedStatus, parseExpectations } from '../../src/engine/validate/expectations.ts'

describe('parseExpectations', () => {
  it('parses a comma-separated list and defaults the phase to both', () => {
    const declared = parseExpectations(
      ['#!/bin/bash', '# expect-fail: fs-var-size, lv-var-size', 'lvextend -L 6G /dev/rhel/var'].join(
        '\n',
      ),
      'a.sh',
    )
    expect(declared).toEqual([
      { id: 'fs-var-size', phase: 'both' },
      { id: 'lv-var-size', phase: 'both' },
    ])
  })

  it('parses per-checkpoint phase suffixes', () => {
    const declared = parseExpectations(
      '# expect-fail: persist-config@both, var-from-lv@post, weird@pre',
      'a.sh',
    )
    expect(declared).toEqual([
      { id: 'persist-config', phase: 'both' },
      { id: 'var-from-lv', phase: 'post' },
      { id: 'weird', phase: 'pre' },
    ])
  })

  it('tolerates extra whitespace and a missing shebang', () => {
    expect(parseExpectations('#   expect-fail:   a@post   ', 'a.sh')).toEqual([
      { id: 'a', phase: 'post' },
    ])
  })

  it('rejects a script with no expect-fail header', () => {
    // An anti-solution that declares nothing cannot validate anything, so it
    // would silently weaken the harness rather than fail loudly.
    const err = (() => {
      try {
        parseExpectations('#!/bin/bash\nlvextend -L 6G /dev/rhel/var\n', 'a.sh')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError

    expect(err).toBeInstanceOf(ContentError)
    expect(err.problems.join('\n')).toMatch(/must declare a "# expect-fail:" header/)
  })

  it('reads an alternate header name, which grade.sh uses for its baseline', () => {
    // Same grammar, same phases — only the label differs.
    expect(
      parseExpectations(
        '# baseline-fail: lv-var-size, var-from-lv@post\n',
        'grade.sh',
        'baseline-fail',
      ),
    ).toEqual([
      { id: 'lv-var-size', phase: 'both' },
      { id: 'var-from-lv', phase: 'post' },
    ])
  })

  it('does not confuse the two header names', () => {
    expect(() => parseExpectations('# baseline-fail: a\n', 'grade.sh')).toThrow(
      /"# expect-fail:" header/,
    )
  })

  it('rejects an empty header', () => {
    const err = (() => {
      try {
        parseExpectations('# expect-fail:', 'a.sh')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError
    expect(err.problems.join('\n')).toMatch(/must name at least one checkpoint/)
  })

  it('rejects an unknown phase', () => {
    const err = (() => {
      try {
        parseExpectations('# expect-fail: a@sometimes', 'a.sh')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError
    expect(err.problems.join('\n')).toMatch(/unknown phase "sometimes"/)
  })

  it('rejects a duplicated checkpoint id', () => {
    const err = (() => {
      try {
        parseExpectations('# expect-fail: a@pre, a@post', 'a.sh')
        return undefined
      } catch (e) {
        return e
      }
    })() as ContentError
    expect(err.problems.join('\n')).toMatch(/declared twice: a/)
  })
})

describe('expectedStatus', () => {
  const declared = [
    { id: 'both-one', phase: 'both' as const },
    { id: 'post-one', phase: 'post' as const },
    { id: 'pre-one', phase: 'pre' as const },
  ]

  it('expects undeclared checkpoints to pass in both verdicts', () => {
    expect(expectedStatus(declared, 'untouched', 'A')).toBe('pass')
    expect(expectedStatus(declared, 'untouched', 'B')).toBe('pass')
  })

  it('expects a both-phase failure in A and B', () => {
    expect(expectedStatus(declared, 'both-one', 'A')).toBe('fail')
    expect(expectedStatus(declared, 'both-one', 'B')).toBe('fail')
  })

  it('expects a post-phase checkpoint to pass in A and fail in B', () => {
    // This is the persistence signature and the whole reason verdict B exists.
    expect(expectedStatus(declared, 'post-one', 'A')).toBe('pass')
    expect(expectedStatus(declared, 'post-one', 'B')).toBe('fail')
  })

  it('expects a pre-phase checkpoint to fail in A and pass in B', () => {
    expect(expectedStatus(declared, 'pre-one', 'A')).toBe('fail')
    expect(expectedStatus(declared, 'pre-one', 'B')).toBe('pass')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/validate/expectations.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/validate/expectations.ts'`.

- [ ] **Step 3: Write the implementation**

`src/engine/validate/expectations.ts`:

```ts
import { ContentError } from '../content/errors.ts'

export type ExpectPhase = 'pre' | 'post' | 'both'

export interface ExpectedFailure {
  id: string
  phase: ExpectPhase
}

const PHASES: readonly string[] = ['pre', 'post', 'both']

function headerRe(name: string): RegExp {
  return new RegExp(`^#\\s*${name}:(.*)$`, 'im')
}

/**
 * Read declared failures from a `# expect-fail:` header.
 *
 * Declaring the phase per checkpoint rather than per file is deliberate: an
 * anti-solution that omits --permanent produces checkpoints that are wrong
 * immediately alongside ones that only break after the reboot, and collapsing
 * that to one phase would let a grader pass while failing at the wrong moment.
 *
 * `header` is a parameter because grade.sh uses the identical syntax under a
 * different name (`# baseline-fail:`) to declare which checkpoints must fail
 * before the student does anything. Same grammar, same phases, same parser.
 */
export function parseExpectations(
  script: string,
  where: string,
  header = 'expect-fail',
): ExpectedFailure[] {
  const match = headerRe(header).exec(script)
  if (!match) {
    throw new ContentError(where, [
      `must declare a "# ${header}:" header naming the checkpoint ids it expects to fail`,
    ])
  }

  const body = (match[1] ?? '').trim()
  if (body === '') {
    throw new ContentError(where, [`"# ${header}:" must name at least one checkpoint id`])
  }

  const problems: string[] = []
  const declared: ExpectedFailure[] = []
  const seen = new Set<string>()

  for (const rawEntry of body.split(',')) {
    const entry = rawEntry.trim()
    if (entry === '') continue

    const [id = '', phaseRaw] = entry.split('@', 2)
    const trimmedId = id.trim()
    if (trimmedId === '') {
      problems.push(`empty checkpoint id in "${entry}"`)
      continue
    }

    const phase = phaseRaw === undefined ? 'both' : phaseRaw.trim()
    if (!PHASES.includes(phase)) {
      problems.push(`unknown phase "${phase}" for ${trimmedId} (use pre, post or both)`)
      continue
    }

    if (seen.has(trimmedId)) {
      problems.push(`checkpoint declared twice: ${trimmedId}`)
      continue
    }
    seen.add(trimmedId)
    declared.push({ id: trimmedId, phase: phase as ExpectPhase })
  }

  if (problems.length > 0) throw new ContentError(where, problems)
  return declared
}

/** What the harness requires of this checkpoint in this verdict. */
export function expectedStatus(
  declared: ExpectedFailure[],
  id: string,
  verdict: 'A' | 'B',
): 'pass' | 'fail' {
  const hit = declared.find((d) => d.id === id)
  if (!hit) return 'pass'
  if (hit.phase === 'both') return 'fail'
  if (hit.phase === 'post') return verdict === 'B' ? 'fail' : 'pass'
  return verdict === 'A' ? 'fail' : 'pass'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 13 new tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/engine/validate test/validate && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(validate): parse anti-solution expect-fail headers

Phase is per checkpoint, not per file, because one anti-solution can produce
both immediately-wrong and only-wrong-after-reboot checkpoints. A missing
header is an error: an anti-solution that declares nothing weakens the harness
silently."
```

---

### Task 11: Validation harness

**Files:**
- Create: `src/engine/validate/harness.ts`
- Test: `test/validate/harness.test.ts`

**Interfaces:**
- Consumes: `TaskSpec` (T3), `LabTransport` (T2), `grade`/`GradeResult` (T8), `parseExpectations`/`expectedStatus` (T10), `statusById` (T5).
- Produces:
  - `type FixtureKind = 'none' | 'solution' | 'antisolution'`
  - `interface Fixture { kind: FixtureKind; name: string; script: string }`
  - `interface TaskScripts { setup: string; grade: string; fixtures: Fixture[] }`
  - `interface HarnessDeps { transport: LabTransport; reset: () => Promise<void>; reboot: () => Promise<void> }`
  - `interface FixtureResult { taskId: string; kind: FixtureKind; name: string; ok: boolean; failures: string[] }`
  - `function loadTaskScripts(task: TaskSpec, assertLib: string): Promise<TaskScripts>`
  - `function validateTask(task: TaskSpec, scripts: TaskScripts, deps: HarnessDeps): Promise<FixtureResult[]>`

**Design note.** I/O is separated from logic: `loadTaskScripts` touches the filesystem, `validateTask` is pure orchestration over already-loaded strings. That is what makes the whole assertion matrix testable against `FakeTransport` with no VM and no fixture files on disk.

**Design note: the `none` fixture.** The obvious rule — "nothing may pass before the student does anything" — is wrong. Real tasks carry *invariant* checkpoints (`home-mounted`, `var-from-lv`) whose whole job is to catch a destructive answer, and those pass at baseline by design. So `grade.sh` declares its own baseline with a `# baseline-fail:` header, using the identical grammar and phase syntax as an anti-solution's `# expect-fail:`, and the harness requires **exactly** those to fail. A task with no header fails validation: without a declaration there is nothing to prove the goal checkpoints are not passing for free.

- [ ] **Step 1: Write the failing test**

`test/validate/harness.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { validateTask, type TaskScripts } from '../../src/engine/validate/harness.ts'
import { FakeTransport } from '../../src/engine/vm/fake.ts'
import type { TaskSpec } from '../../src/engine/content/task.ts'

function task(over: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: 'storage/014-grow-var',
    title: 'Grow var',
    chapter: 15,
    scope: 'exam-objective',
    rhel: 9,
    objectives: ['storage.lvm.resize'],
    requiresConcepts: [],
    difficulty: 3,
    timeBudget: 480,
    weight: 'high',
    editions: ['r9'],
    rebootCheck: true,
    requiresDisks: 0,
    claims: [],
    transport: 'ssh',
    prompt: 'Grow var.',
    dir: '/nowhere',
    ...over,
  }
}

/**
 * A two-variable world: did the LV grow, and is there a persistence config?
 * The handler is a state machine, never a simulated Linux.
 */
function world() {
  const state = { grown: false, persisted: false, mounted: false, rebooted: false }

  const handler = (script: string) => {
    if (script.includes('SETUP')) {
      state.grown = false
      state.persisted = false
      state.mounted = true
      state.rebooted = false
      return { stdout: '', stderr: '', code: 0 }
    }
    // Non-exclusive, and deliberately so: the correct solution is the single
    // script 'GROW\nPERSIST\n', so an if/return chain would set `grown` and
    // return before it ever noticed the PERSIST line.
    if (script.includes('GROW')) {
      state.grown = true
      state.mounted = true
    }
    if (script.includes('PERSIST')) {
      state.persisted = true
    }
    if (script.includes('GROW') || script.includes('PERSIST')) {
      return { stdout: '', stderr: '', code: 0 }
    }
    if (script.includes('GRADE')) {
      const mounted = state.rebooted ? state.persisted : state.mounted
      const lines = [
        `{"id":"lv-var-size","desc":"var LV >= 6G","status":"${state.grown ? 'pass' : 'fail'}"}`,
        `{"id":"persist-config","desc":"mounts at boot","status":"${state.persisted ? 'pass' : 'fail'}"}`,
        `{"id":"var-from-lv","desc":"/var mounted","status":"${mounted ? 'pass' : 'fail'}"}`,
      ]
      return { stdout: lines.join('\n'), stderr: '', code: 0 }
    }
    return { stdout: '', stderr: '', code: 0 }
  }

  return { state, handler }
}

function deps(w: ReturnType<typeof world>) {
  const transport = new FakeTransport(w.handler)
  return {
    transport,
    reset: async () => {
      w.state.grown = false
      w.state.persisted = false
      w.state.mounted = false
      w.state.rebooted = false
    },
    reboot: async () => {
      w.state.rebooted = true
    },
  }
}

const CORRECT = 'GROW\nPERSIST\n'
const FORGOT_PERSIST = 'GROW\n'

/**
 * grade.sh declares its own baseline. In this world, before any work: the LV
 * has not grown and nothing is persisted, but /var IS still mounted — so
 * var-from-lv passes now and only fails after the reboot.
 */
const BASELINE = '# baseline-fail: lv-var-size, persist-config, var-from-lv@post\n'

function scripts(over: Partial<TaskScripts> = {}): TaskScripts {
  return {
    setup: 'SETUP',
    grade: `${BASELINE}GRADE`,
    fixtures: [
      { kind: 'none', name: 'no-action', script: '' },
      { kind: 'solution', name: '01-lvextend.sh', script: CORRECT },
      { kind: 'solution', name: '02-mount-unit.sh', script: CORRECT },
      {
        kind: 'antisolution',
        name: '01-forgot-persistence.sh',
        script: `# expect-fail: persist-config, var-from-lv@post\n${FORGOT_PERSIST}`,
      },
    ],
    ...over,
  }
}

describe('validateTask', () => {
  it('passes a well-formed task with correct solutions and a declared anti-solution', async () => {
    const w = world()
    const results = await validateTask(task(), scripts(), deps(w))

    expect(results.map((r) => r.name)).toEqual([
      'no-action',
      '01-lvextend.sh',
      '02-mount-unit.sh',
      '01-forgot-persistence.sh',
    ])
    for (const r of results) {
      expect(r.failures, `${r.name}: ${r.failures.join('; ')}`).toEqual([])
      expect(r.ok).toBe(true)
    }
  })

  it('fails the no-action fixture when a goal checkpoint passes without work', async () => {
    const w = world()
    // A grader that reports a pass on an untouched system is the dangerous
    // direction of error, so the no-action fixture must catch it.
    const s = scripts({ grade: `${BASELINE}GRADE_ALWAYS_PASS` })
    const bad = deps(w)
    bad.transport = new FakeTransport((script) =>
      script.includes('GRADE')
        ? {
            stdout: [
              '{"id":"lv-var-size","desc":"x","status":"pass"}',
              '{"id":"persist-config","desc":"y","status":"fail"}',
              '{"id":"var-from-lv","desc":"z","status":"pass"}',
            ].join('\n'),
            stderr: '',
            code: 0,
          }
        : { stdout: '', stderr: '', code: 0 },
    )

    const results = await validateTask(task(), s, bad)
    const none = results.find((r) => r.kind === 'none')
    expect(none?.ok).toBe(false)
    expect(none?.failures.join('\n')).toMatch(/verdict A lv-var-size: expected fail, got pass/)
  })

  it('accepts an invariant checkpoint that passes at baseline', async () => {
    // var-from-lv is a "do not break this" check, not a goal. Requiring it to
    // fail before the student starts would make every honest task unvalidatable.
    // Asserted the distinguishing way, so this is not a restatement of the
    // headline test: name var-from-lv in the *pre-reboot* baseline and the
    // harness must object to that id and only that id — which is the same
    // statement as "var-from-lv passes in verdict A while lv-var-size fails
    // there, exactly as declared".
    const w = world()
    const s = scripts({
      grade: '# baseline-fail: lv-var-size, persist-config, var-from-lv\nGRADE',
    })
    const results = await validateTask(task(), s, deps(w))
    const none = results.find((r) => r.kind === 'none')
    const text = none?.failures.join('\n') ?? ''
    expect(text).toMatch(/verdict A var-from-lv: expected fail, got pass/)
    expect(text).not.toMatch(/lv-var-size/)
  })

  it('fails a task whose grade.sh declares no baseline', async () => {
    const w = world()
    const results = await validateTask(task(), scripts({ grade: 'GRADE' }), deps(w))
    const none = results.find((r) => r.kind === 'none')
    expect(none?.ok).toBe(false)
    expect(none?.failures.join('\n')).toMatch(/"# baseline-fail:" header/)
  })

  it('stops immediately when setup.sh fails, instead of grading the wrong machine', async () => {
    const w = world()
    const bad = deps(w)
    bad.transport = new FakeTransport((script) =>
      script.includes('SETUP')
        ? { stdout: '', stderr: '/home is not on the rhel-home LV', code: 1 }
        : { stdout: '', stderr: '', code: 0 },
    )

    const results = await validateTask(task(), scripts(), bad)
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures).toEqual([
      'setup.sh exited 1: /home is not on the rhel-home LV',
    ])
  })

  it('fails a baseline declaration naming a checkpoint the grader never emits', async () => {
    const w = world()
    const s = scripts({ grade: `# baseline-fail: lv-var-size, typo-id\nGRADE` })
    const results = await validateTask(task(), s, deps(w))
    const none = results.find((r) => r.kind === 'none')
    expect(none?.failures.join('\n')).toMatch(/baseline-fail names typo-id/)
  })

  it('fails a solution that does not pass every checkpoint, catching over-fitting', async () => {
    const w = world()
    const s = scripts()
    s.fixtures = [{ kind: 'solution', name: '03-partial.sh', script: FORGOT_PERSIST }]

    const results = await validateTask(task(), s, deps(w))
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures.join('\n')).toMatch(/persist-config: expected pass, got fail/)
  })

  it('fails an anti-solution whose declared checkpoint did not actually fail', async () => {
    const w = world()
    const s = scripts()
    s.fixtures = [
      {
        kind: 'antisolution',
        name: '02-wrong-declaration.sh',
        script: `# expect-fail: lv-var-size\n${CORRECT}`,
      },
    ]

    const results = await validateTask(task(), s, deps(w))
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures.join('\n')).toMatch(/lv-var-size: expected fail, got pass/)
  })

  it('fails an anti-solution that breaks a checkpoint it did not declare', async () => {
    // This is the assertion that proves the right check caught the error, not
    // merely that something failed.
    const w = world()
    const s = scripts()
    s.fixtures = [
      {
        kind: 'antisolution',
        name: '03-underdeclared.sh',
        script: '# expect-fail: persist-config\nGROW\n',
      },
    ]

    const results = await validateTask(task(), s, deps(w))
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures.join('\n')).toMatch(/var-from-lv: expected pass, got fail/)
  })

  it('requires at least two solutions and one anti-solution', async () => {
    const w = world()
    const s = scripts()
    s.fixtures = [{ kind: 'solution', name: '01.sh', script: CORRECT }]

    const results = await validateTask(task(), s, deps(w))
    const gate = results.find((r) => r.kind === 'none' && r.name === 'fixture-inventory')
    expect(gate?.ok).toBe(false)
    expect(gate?.failures.join('\n')).toMatch(/needs at least 2 solutions/)
    expect(gate?.failures.join('\n')).toMatch(/needs at least 1 anti-solution/)
  })

  it('rejects a post-phase declaration on a task that never reboots', async () => {
    const w = world()
    const s = scripts()
    s.fixtures = [
      {
        kind: 'antisolution',
        name: '04-post-without-reboot.sh',
        script: `# expect-fail: var-from-lv@post\n${FORGOT_PERSIST}`,
      },
    ]

    const results = await validateTask(task({ rebootCheck: false }), s, deps(w))
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures.join('\n')).toMatch(
      /declares @post but the task has reboot_check: false/,
    )
  })

  it('reports duplicate checkpoint ids emitted by the grader', async () => {
    const w = world()
    const bad = deps(w)
    bad.transport = new FakeTransport((script) =>
      script.includes('GRADE')
        ? {
            stdout: [
              '{"id":"dup","desc":"x","status":"pass"}',
              '{"id":"dup","desc":"y","status":"pass"}',
            ].join('\n'),
            stderr: '',
            code: 0,
          }
        : { stdout: '', stderr: '', code: 0 },
    )
    const s = scripts()
    s.fixtures = [{ kind: 'solution', name: '01.sh', script: CORRECT }]

    const results = await validateTask(task({ rebootCheck: false }), s, bad)
    expect(results[0]?.failures.join('\n')).toMatch(/grader emitted duplicate checkpoint ids: dup/)
  })

  it('resets before every fixture so fixtures cannot contaminate each other', async () => {
    const w = world()
    let resets = 0
    const d = deps(w)
    const innerReset = d.reset
    d.reset = async () => {
      resets++
      await innerReset()
    }

    await validateTask(task(), scripts(), d)
    // 4 fixtures, one reset each.
    expect(resets).toBe(4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/validate/harness.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/validate/harness.ts'`.

- [ ] **Step 3: Write the implementation**

`src/engine/validate/harness.ts`:

```ts
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { TaskSpec } from '../content/task.ts'
import { grade } from '../grading/grader.ts'
import { duplicateIds, statusById, type Verdict } from '../grading/verdict.ts'
import type { LabTransport } from '../vm/transport.ts'
import { expectedStatus, parseExpectations, type ExpectedFailure } from './expectations.ts'

export type FixtureKind = 'none' | 'solution' | 'antisolution'

export interface Fixture {
  kind: FixtureKind
  name: string
  script: string
}

export interface TaskScripts {
  setup: string
  /** grade.sh with the assertion library already prepended. */
  grade: string
  fixtures: Fixture[]
}

export interface HarnessDeps {
  transport: LabTransport
  /** Revert to the clean snapshot. */
  reset: () => Promise<void>
  reboot: () => Promise<void>
}

export interface FixtureResult {
  taskId: string
  kind: FixtureKind
  name: string
  ok: boolean
  failures: string[]
}

const MIN_SOLUTIONS = 2
const MIN_ANTISOLUTIONS = 1

export async function loadTaskScripts(task: TaskSpec, assertLib: string): Promise<TaskScripts> {
  const setup = await readFile(join(task.dir, 'setup.sh'), 'utf8')
  const gradeBody = await readFile(join(task.dir, 'grade.sh'), 'utf8')

  const collect = async (sub: string, kind: FixtureKind): Promise<Fixture[]> => {
    const dir = join(task.dir, sub)
    const names = (await readdir(dir).catch(() => [])).filter((n) => n.endsWith('.sh')).sort()
    return Promise.all(
      names.map(async (name) => ({
        kind,
        name,
        script: await readFile(join(dir, name), 'utf8'),
      })),
    )
  }

  return {
    setup,
    grade: `${assertLib}\n${gradeBody}`,
    fixtures: [
      { kind: 'none', name: 'no-action', script: '' },
      ...(await collect('solutions', 'solution')),
      ...(await collect('antisolutions', 'antisolution')),
    ],
  }
}

function inventoryGate(task: TaskSpec, scripts: TaskScripts): FixtureResult {
  const failures: string[] = []
  const solutions = scripts.fixtures.filter((f) => f.kind === 'solution').length
  const antis = scripts.fixtures.filter((f) => f.kind === 'antisolution').length

  // Multiple independent solutions are what catch a grader over-fitted to one
  // author's habits; anti-solutions are what catch false positives.
  if (solutions < MIN_SOLUTIONS) {
    failures.push(`needs at least ${MIN_SOLUTIONS} solutions, found ${solutions}`)
  }
  if (antis < MIN_ANTISOLUTIONS) {
    failures.push(`needs at least ${MIN_ANTISOLUTIONS} anti-solution, found ${antis}`)
  }

  return {
    taskId: task.id,
    kind: 'none',
    name: 'fixture-inventory',
    ok: failures.length === 0,
    failures,
  }
}

function checkVerdict(
  verdict: Verdict,
  label: 'A' | 'B',
  expect: (id: string) => 'pass' | 'fail',
  failures: string[],
): void {
  if (verdict.checkpoints.length === 0) {
    failures.push(`verdict ${label}: grader emitted no checkpoints`)
  }
  for (const cp of verdict.checkpoints) {
    const want = expect(cp.id)
    const got = cp.status === 'pass' ? 'pass' : 'fail'
    if (got !== want) {
      const detail = cp.detail ? ` (${cp.detail})` : ''
      failures.push(`verdict ${label} ${cp.id}: expected ${want}, got ${cp.status}${detail}`)
    }
  }
}

async function runFixture(
  task: TaskSpec,
  scripts: TaskScripts,
  fixture: Fixture,
  deps: HarnessDeps,
): Promise<FixtureResult> {
  const failures: string[] = []

  let declared: ExpectedFailure[] = []
  if (fixture.kind === 'antisolution') {
    try {
      declared = parseExpectations(fixture.script, `${task.id}/antisolutions/${fixture.name}`)
    } catch (e) {
      return {
        taskId: task.id,
        kind: fixture.kind,
        name: fixture.name,
        ok: false,
        failures: [e instanceof Error ? e.message : String(e)],
      }
    }

    if (!task.rebootCheck && declared.some((d) => d.phase === 'post')) {
      const ids = declared
        .filter((d) => d.phase === 'post')
        .map((d) => d.id)
        .join(', ')
      if (ids !== '') {
        failures.push(
          `declares @post but the task has reboot_check: false, so verdict B never runs (${ids})`,
        )
      }
    }
  }

  await deps.reset()

  // A setup script that fails leaves the fixture measuring the wrong machine,
  // so every downstream failure would be a red herring. Stop here instead.
  const setupResult = await deps.transport.exec(scripts.setup)
  if (setupResult.code !== 0) {
    failures.push(`setup.sh exited ${setupResult.code}: ${setupResult.stderr.trim()}`)
    return { taskId: task.id, kind: fixture.kind, name: fixture.name, ok: false, failures }
  }

  if (fixture.script.trim() !== '') await deps.transport.exec(fixture.script)

  const result = await grade({
    task,
    transport: deps.transport,
    gradeScript: scripts.grade,
    reboot: deps.reboot,
  })

  if (result.rebootError !== undefined) {
    failures.push(`reboot failed: ${result.rebootError}`)
  }

  // Once, against verdict A only. Duplicate ids are a property of the grader,
  // not of a particular run, so checking inside checkVerdict would report the
  // same duplicate twice on any task with reboot_check: true.
  const dupes = duplicateIds(result.verdictA)
  if (dupes.length > 0) {
    failures.push(`grader emitted duplicate checkpoint ids: ${dupes.join(', ')}`)
  }

  if (fixture.kind === 'none') {
    // "Nothing may pass" is wrong for any task with an invariant checkpoint —
    // `home-mounted` is supposed to pass before the student touches anything.
    // So the task declares which checkpoints are the *goal*, and exactly those
    // must fail at baseline. Everything else must pass.
    // const, not let: TypeScript cannot narrow a `let` inside the closure below.
    const baseline = (() => {
      try {
        return parseExpectations(scripts.grade, `${task.id}/grade.sh`, 'baseline-fail')
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e))
        return undefined
      }
    })()

    if (baseline) {
      const emitted = new Set(result.verdictA.checkpoints.map((c) => c.id))
      for (const d of baseline) {
        if (!emitted.has(d.id)) {
          failures.push(`baseline-fail names ${d.id}, which the grader never emits`)
        }
      }
      const want = (label: 'A' | 'B') => (id: string) => expectedStatus(baseline, id, label)
      checkVerdict(result.verdictA, 'A', want('A'), failures)
      if (result.verdictB) checkVerdict(result.verdictB, 'B', want('B'), failures)
    }
  } else {
    const want = (label: 'A' | 'B') => (id: string) =>
      fixture.kind === 'solution' ? 'pass' : expectedStatus(declared, id, label)

    checkVerdict(result.verdictA, 'A', want('A'), failures)
    if (result.verdictB) checkVerdict(result.verdictB, 'B', want('B'), failures)
    else if (task.rebootCheck && result.rebootError === undefined) {
      // No verdict B on a reboot-checking task means verdict A had no passes at
      // all, which a solution must never produce.
      if (fixture.kind === 'solution') {
        failures.push('verdict B was skipped: no checkpoint passed before the reboot')
      }
    }
  }

  // Keep the pass/fail comparison honest about ids that vanished between runs.
  if (result.verdictB) {
    const a = statusById(result.verdictA)
    for (const cp of result.verdictB.checkpoints) {
      if (!a.has(cp.id)) failures.push(`${cp.id} appeared only after the reboot`)
    }
  }

  return { taskId: task.id, kind: fixture.kind, name: fixture.name, ok: failures.length === 0, failures }
}

export async function validateTask(
  task: TaskSpec,
  scripts: TaskScripts,
  deps: HarnessDeps,
): Promise<FixtureResult[]> {
  const results: FixtureResult[] = []

  const gate = inventoryGate(task, scripts)

  // The fixture results come first and the gate last. Ordering matters: every
  // test that indexes `results[0]` means "the first fixture", and pushing the
  // gate ahead of the loop would silently retarget those assertions at the
  // inventory check instead.
  for (const fixture of scripts.fixtures) {
    results.push(await runFixture(task, scripts, fixture, deps))
  }

  if (!gate.ok) results.push(gate)

  return results
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 13 new tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/engine/validate/harness.ts test/validate/harness.test.ts && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(validate): add the fixture matrix harness

I/O is split from orchestration so the entire assertion matrix runs against
FakeTransport with no VM. Anti-solutions must fail exactly their declared
checkpoints and no others, which is what proves the right check caught the
error rather than merely that something failed."
```

---

### Task 12: CLI with the `coverage` command

**Files:**
- Create: `src/cli/index.ts`
- Test: `test/cli/coverage.test.ts`

**Interfaces:**
- Consumes: `loadBank`/`checkCoverage` (T7), `ContentError` (T2).
- Produces:
  - `interface CliIo { out: (line: string) => void; err: (line: string) => void }`
  - `function run(argv: string[], io: CliIo): Promise<number>` — resolves to the process exit code

**Scope note.** Only `coverage` lands here, because it is the one command that needs no VM. `rhcsa validate` is added in Task 21, once `chooseTransport` and `VmController` exist to wire it to.

- [ ] **Step 1: Write the failing test**

`test/cli/coverage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { run } from '../../src/cli/index.ts'

const BANK = new URL('../fixtures/bank', import.meta.url).pathname

function capture() {
  const out: string[] = []
  const err: string[] = []
  return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err }
}

describe('rhcsa coverage', () => {
  it('reports counts and exits 0 when every reference resolves', async () => {
    const c = capture()
    const code = await run(['coverage', '--content', BANK], c.io)

    expect(code).toBe(0)
    const text = c.out.join('\n')
    expect(text).toMatch(/tasks: 2/)
    expect(text).toMatch(/concepts: 2/)
    expect(text).toMatch(/objectives: 3/)
    expect(text).toMatch(/uncovered objectives: 1/)
    expect(text).toMatch(/autofs\.maps\.configure/)
    expect(text).toMatch(/untaught concepts: 1/)
    expect(text).toMatch(/storage\.orphan-concept/)
  })

  it('exits 1 under --strict while coverage gaps remain', async () => {
    // Gaps are expected during Phase 1, so they only become failures on demand.
    const c = capture()
    const code = await run(['coverage', '--content', BANK, '--strict'], c.io)
    expect(code).toBe(1)
    expect(c.err.join('\n')).toMatch(/1 uncovered objective/)
  })

  it('reports a ContentError legibly and exits 1', async () => {
    const c = capture()
    const code = await run(
      ['coverage', '--content', new URL('../fixtures/bank-dupe', import.meta.url).pathname],
      c.io,
    )
    expect(code).toBe(1)
    expect(c.err.join('\n')).toMatch(/duplicate task id/)
  })

  it('exits 2 with usage on an unknown command', async () => {
    const c = capture()
    expect(await run(['frobnicate'], c.io)).toBe(2)
    expect(c.err.join('\n')).toMatch(/usage: rhcsa/)
  })

  it('exits 2 with usage when no command is given', async () => {
    const c = capture()
    expect(await run([], c.io)).toBe(2)
    expect(c.err.join('\n')).toMatch(/usage: rhcsa/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/cli/coverage.test.ts`
Expected: FAIL — `Cannot find module '../../src/cli/index.ts'`.

- [ ] **Step 3: Write the implementation**

`src/cli/index.ts`:

```ts
import { checkCoverage, loadBank } from '../engine/content/bank.ts'
import { ContentError } from '../engine/content/errors.ts'

export interface CliIo {
  out: (line: string) => void
  err: (line: string) => void
}

const USAGE = `usage: rhcsa <command> [options]

commands:
  coverage    report content coverage gaps

options:
  --content <dir>   content root (default: ./content)
  --strict          exit non-zero while coverage gaps remain`

function flag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`)
}

function option(argv: string[], name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  return argv[i + 1] ?? fallback
}

async function coverage(argv: string[], io: CliIo): Promise<number> {
  const root = option(argv, 'content', 'content')
  const strict = flag(argv, 'strict')

  let bank
  try {
    bank = await loadBank(root)
  } catch (e) {
    if (e instanceof ContentError) {
      io.err(e.message)
      return 1
    }
    throw e
  }

  const report = checkCoverage(bank)

  io.out(`content root: ${bank.root}`)
  io.out(`tasks: ${bank.tasks.length}`)
  io.out(`concepts: ${bank.concepts.length}`)
  io.out(`objectives: ${bank.objectives.objectives.length}`)
  io.out(`uncovered objectives: ${report.uncoveredObjectives.length}`)
  for (const id of report.uncoveredObjectives) io.out(`  - ${id}`)
  io.out(`untaught concepts: ${report.untaughtConcepts.length}`)
  for (const id of report.untaughtConcepts) io.out(`  - ${id}`)

  if (report.problems.length > 0) {
    for (const p of report.problems) io.err(`problem: ${p}`)
    return 1
  }

  if (strict) {
    const gaps = report.uncoveredObjectives.length + report.untaughtConcepts.length
    if (gaps > 0) {
      io.err(
        `${report.uncoveredObjectives.length} uncovered objective(s), ` +
          `${report.untaughtConcepts.length} untaught concept(s)`,
      )
      return 1
    }
  }

  return 0
}

export async function run(argv: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv

  switch (command) {
    case 'coverage':
      return await coverage(rest, io)
    default:
      io.err(USAGE)
      return 2
  }
}

// Only run when invoked directly, so importing this module in tests is inert.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  const code = await run(process.argv.slice(2), {
    out: (l) => process.stdout.write(`${l}\n`),
    err: (l) => process.stderr.write(`${l}\n`),
  })
  process.exit(code)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 5 new tests PASS; typecheck clean.

- [ ] **Step 5: Verify the CLI works when invoked for real**

Run:
```bash
cd /home/daxtangco/rhcsa-trainer
node src/cli/index.ts coverage --content test/fixtures/bank; echo "exit=$?"
node src/cli/index.ts; echo "exit=$?"
```
Expected: first prints the report and `exit=0`; second prints usage to stderr and `exit=2`.

- [ ] **Step 6: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/cli test/cli && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(cli): add rhcsa coverage

run() returns an exit code instead of calling process.exit so it is testable.
Coverage gaps only fail under --strict, since they are the normal state until
the bank is complete."
```

---

### Task 13: Transcribe the objective taxonomies

Phase 0's central data artifact. **The mapping tables are rendered images in both editions** — `pdftotext` returns nothing for them, so they must be read visually.

**Files:**
- Create: `content/objectives.yaml`, `content/objectives-rhel10.yaml`
- Test: `test/content/objectives-real.test.ts`

**Interfaces:**
- Consumes: `loadObjectives` (T6).
- Produces: the objective id vocabulary every `task.yaml` and concept references. **Ids created here are permanent** — they are the FSRS scheduling keys, so renaming one later orphans history.

**Sources, in priority order:**
1. Red Hat's published EX200 objectives for RHEL 9 — the contractual statement of what is testable.
2. RHCSA 9 Cert Guide mapping table, **page 38** of `/mnt/c/Users/DaxAxisTangco/Downloads/(REFERENCE) Red Hat RHCSA 9 Cert Guide EX200.pdf`.
3. RHCSA 10 Cert Guide mapping table, **page 42** of `/mnt/c/Users/DaxAxisTangco/Downloads/Red_Hat_RHCSA_10_Cert_Guide_EX200_ER_-_Sander_van_Vugt.pdf`.

- [ ] **Step 1: Read the RHCSA 9 mapping table visually**

Use the `Read` tool with `pages: "38-40"` on the RHCSA 9 PDF. Record, verbatim, every row's Objective text and Chapter number. Do **not** use `pdftotext` — it returns an empty body for these pages because they are images.

- [ ] **Step 2: Cross-check against Red Hat's published list**

`WebFetch` `https://www.redhat.com/en/services/training/ex200-red-hat-certified-system-administrator-rhcsa-exam` and reconcile. Where the book and Red Hat disagree on wording, **Red Hat's wording wins** and goes in `text:`; the book's chapter number goes in `chapters:`. Note any objective present in one source and not the other in a `# comment` on that entry.

- [ ] **Step 3: Write `content/objectives.yaml`**

Use dotted lowercase ids grouped by area. The file must open with the two required scalars, then one entry per objective:

```yaml
version: rhel9
source: "Red Hat EX200 published objectives, cross-checked against RHCSA 9 Cert Guide mapping table p.38 (read visually; the table is a rendered image)"
objectives:
  - id: tools.shell.essentials
    text: Use grep and regular expressions to analyze text
    chapters: [4]
  - id: storage.lvm.resize
    text: Extend existing logical volumes
    chapters: [15]
  # ... one entry per published objective, ids grouped by area:
  #   tools.*      shell, redirection, editors, archives, ssh, man
  #   files.*      permissions, ACLs, links, find
  #   users.*      local accounts, groups, aging, sudo
  #   storage.*    partitions, lvm, filesystems, swap, autofs, nfs
  #   boot.*       targets, grub, rescue, root password recovery
  #   systemd.*    services, units, timers
  #   net.*        addressing, hostname, firewall, ssh server
  #   pkg.*        dnf, repositories, modules
  #   selinux.*    modes, contexts, booleans, troubleshooting
  #   containers.* podman, rootless, systemd integration
  #   sys.*        tuned, time, logs, cron/at
```

Rules while transcribing:
- One objective per published bullet. Do not merge two bullets into one id, and do not split one bullet into two — the ids are the scheduling keys and must map 1:1 to what Red Hat publishes.
- Every id must match `^[a-z0-9]+(\.[a-z0-9]+(-[a-z0-9]+)*)+$`.
- `chapters` must be integers 1–28, at least one per objective.
- **Include the `containers.*` objectives.** They are in scope for RHEL 9 and are the single largest casualty if the exam version turns out to be RHEL 10 (risk R2).

- [ ] **Step 4: Write `content/objectives-rhel10.yaml`**

Repeat steps 1–3 against page 42 of the RHCSA 10 PDF, with `version: rhel10`. Nothing loads this file yet; it exists so the R2 delta is enumerated rather than guessed, per spec §16 Phase 0.

Reuse the same ids wherever an objective is unchanged, so a future diff of the two files is meaningful. Expect `containers.*` to be absent and a `pkg.flatpak.*` area to be present.

- [ ] **Step 5: Write the validation test**

`test/content/objectives-real.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { loadObjectives } from '../../src/engine/content/objectives.ts'

const ROOT = new URL('../../content/', import.meta.url).pathname

describe('content/objectives.yaml', () => {
  it('loads without a ContentError', async () => {
    const set = await loadObjectives(`${ROOT}objectives.yaml`)
    expect(set.version).toBe('rhel9')
  })

  it('cites its source, because the mapping tables are images and must be read visually', async () => {
    const set = await loadObjectives(`${ROOT}objectives.yaml`)
    expect(set.source).toMatch(/visual/i)
  })

  it('has a plausible objective count', async () => {
    // EX200 publishes dozens of bullets across ~10 areas. Far fewer means
    // bullets were merged; far more means they were split.
    const set = await loadObjectives(`${ROOT}objectives.yaml`)
    expect(set.objectives.length).toBeGreaterThanOrEqual(20)
    expect(set.objectives.length).toBeLessThanOrEqual(80)
  })

  it('covers every area the exam is organised around', async () => {
    const set = await loadObjectives(`${ROOT}objectives.yaml`)
    const areas = new Set(set.objectives.map((o) => o.id.split('.')[0]))
    for (const area of [
      'tools',
      'files',
      'users',
      'storage',
      'boot',
      'systemd',
      'net',
      'pkg',
      'selinux',
      'containers',
      'sys',
    ]) {
      expect(areas, `missing area: ${area}`).toContain(area)
    }
  })

  it('includes the LVM and SELinux context objectives the Phase 1 tasks need', async () => {
    const set = await loadObjectives(`${ROOT}objectives.yaml`)
    const ids = set.objectives.map((o) => o.id)
    expect(ids.some((id) => id.startsWith('storage.lvm'))).toBe(true)
    expect(ids.some((id) => id.startsWith('selinux.'))).toBe(true)
    expect(ids.some((id) => id.startsWith('users.'))).toBe(true)
    expect(ids.some((id) => id.startsWith('systemd.'))).toBe(true)
  })
})

describe('content/objectives-rhel10.yaml', () => {
  it('loads and is tagged rhel10', async () => {
    const set = await loadObjectives(`${ROOT}objectives-rhel10.yaml`)
    expect(set.version).toBe('rhel10')
  })

  it('drops containers and adds flatpak, enumerating risk R2', async () => {
    const r10 = await loadObjectives(`${ROOT}objectives-rhel10.yaml`)
    const areas = new Set(r10.objectives.map((o) => o.id.split('.')[0]))
    expect(areas.has('containers')).toBe(false)
    expect(r10.objectives.some((o) => o.id.includes('flatpak'))).toBe(true)
  })

  it('reuses ids for unchanged objectives so the two files diff meaningfully', async () => {
    const r9 = await loadObjectives(`${ROOT}objectives.yaml`)
    const r10 = await loadObjectives(`${ROOT}objectives-rhel10.yaml`)
    const shared = r10.objectives.filter((o) => r9.byId.has(o.id))
    // Chapters 1-25 align 1:1 across editions, so most ids must be shared.
    expect(shared.length).toBeGreaterThan(r10.objectives.length / 2)
  })
})
```

- [ ] **Step 6: Run the tests**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test`
Expected: 8 new tests PASS. If the count assertion fails, re-read the source pages rather than adjusting the bound — the bound exists to catch merged or split bullets.

- [ ] **Step 7: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add content/objectives.yaml content/objectives-rhel10.yaml test/content/objectives-real.test.ts && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(content): transcribe the RHEL 9 and RHEL 10 objective taxonomies

Both mapping tables are rendered images, so they were read visually rather
than extracted. Red Hat's published wording wins over the book's; the book
supplies chapter numbers. The RHEL 10 file enumerates risk R2 - containers
absent, flatpak present - and reuses ids so the two files diff meaningfully."
```

---

### Task 14: Corpus extraction script

Turns both PDFs into structured raw input for authoring, and computes the cross-edition weight signal (spec §14.4 use 1).

**Files:**
- Create: `scripts/extract-corpus.ts`
- Test: `test/corpus/extract.test.ts`

**Interfaces:**
- Consumes: nothing from the engine — this is a standalone script.
- Produces:
  - `interface CorpusItem { id: string; kind: 'lab' | 'exercise'; chapter: number; edition: string; text: string }`
  - `function findItems(fullText: string, edition: string): CorpusItem[]`
  - `function weightSignal(items: CorpusItem[]): Record<string, string[]>` — item id → editions containing it
  - CLI entry writing `corpus/<edition>/labs.json`, `corpus/<edition>/exercises.json`, `corpus/signal.json`

- [ ] **Step 1: Write the failing test**

`test/corpus/extract.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { findItems, weightSignal } from '../../scripts/extract-corpus.ts'

const SAMPLE = [
  'Chapter 15. Managing Advanced Storage',
  'some prose about volume groups',
  '',
  'Exercise 15-1 Creating a volume group',
  '1. Open a root shell.',
  '2. Run vgcreate vgdata /dev/sdb.',
  '',
  'Exercise 15-2 Extending a logical volume',
  '1. Run lvextend -L 6G /dev/vgdata/lvdata.',
  '',
  'Lab 15.1  Managing logical volumes',
  'Create a volume group and a 6 GB logical volume.',
  '',
  'Chapter 16. Managing Autofs',
  'Exercise 16-1 Configuring autofs',
  '1. Install autofs.',
].join('\n')

describe('findItems', () => {
  it('finds exercises with their chapter and body', () => {
    const items = findItems(SAMPLE, 'r9')
    const ex = items.filter((i) => i.kind === 'exercise')

    expect(ex.map((i) => i.id)).toEqual(['Exercise 15-1', 'Exercise 15-2', 'Exercise 16-1'])
    expect(ex[0]?.chapter).toBe(15)
    expect(ex[0]?.text).toMatch(/vgcreate vgdata/)
    expect(ex[2]?.chapter).toBe(16)
    expect(ex[0]?.edition).toBe('r9')
  })

  it('finds labs and tolerates the double space the layout extraction leaves', () => {
    const items = findItems(SAMPLE, 'r9')
    const labs = items.filter((i) => i.kind === 'lab')

    expect(labs.map((i) => i.id)).toEqual(['Lab 15.1'])
    expect(labs[0]?.chapter).toBe(15)
    expect(labs[0]?.text).toMatch(/6 GB logical volume/)
  })

  it('stops an item body at the next heading rather than swallowing the chapter', () => {
    const items = findItems(SAMPLE, 'r9')
    const first = items.find((i) => i.id === 'Exercise 15-1')
    expect(first?.text).not.toMatch(/Extending a logical volume/)
  })

  it('deduplicates ids that appear in both a table of contents and the body', () => {
    // Every lab and exercise id appears at least twice: once in the contents
    // listing and once at the real heading. The longest body wins, because the
    // contents entry is a single line.
    const withToc = ['Exercise 15-1 Creating a volume group', '', SAMPLE].join('\n')
    const ids = findItems(withToc, 'r9')
      .filter((i) => i.kind === 'exercise')
      .map((i) => i.id)
    expect(ids).toEqual(['Exercise 15-1', 'Exercise 15-2', 'Exercise 16-1'])
  })
})

describe('weightSignal', () => {
  it('records which editions contain each item', () => {
    const items = [
      ...findItems(SAMPLE, 'r9'),
      ...findItems('Chapter 15. x\nExercise 15-1 Creating a volume group\n1. Do it.', 'r10'),
    ]
    const signal = weightSignal(items)

    // Present in both editions: durable core RHCSA material.
    expect(signal['Exercise 15-1']).toEqual(['r10', 'r9'])
    // Present in one: version-specific.
    expect(signal['Lab 15.1']).toEqual(['r9'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/corpus/extract.test.ts`
Expected: FAIL — `Cannot find module '../../scripts/extract-corpus.ts'`.

- [ ] **Step 3: Write the implementation**

`scripts/extract-corpus.ts`:

```ts
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface CorpusItem {
  id: string
  kind: 'lab' | 'exercise'
  chapter: number
  edition: string
  text: string
}

/** `Lab 15.1` / `Lab  15.1` — layout extraction leaves variable spacing. */
const LAB_RE = /^\s*(Lab) +(\d+)\.(\d+)\b/
/** `Exercise 15-1` */
const EX_RE = /^\s*(Exercise) +(\d+)-(\d+)\b/
/** RHCSA 9 uses `Chapter 15 `, RHCSA 10 uses `Chapter 15.` */
const CHAPTER_RE = /^\s*Chapter +(\d+)[.\s]/

/** Cap a body so a missed heading cannot swallow half a chapter. */
const MAX_BODY_LINES = 120

function heading(line: string): { kind: 'lab' | 'exercise'; id: string; chapter: number } | undefined {
  const lab = LAB_RE.exec(line)
  if (lab) {
    return { kind: 'lab', id: `Lab ${lab[2]}.${lab[3]}`, chapter: Number(lab[2]) }
  }
  const ex = EX_RE.exec(line)
  if (ex) {
    return { kind: 'exercise', id: `Exercise ${ex[2]}-${ex[3]}`, chapter: Number(ex[2]) }
  }
  return undefined
}

/**
 * Slice labs and exercises out of `pdftotext -layout` output.
 *
 * Every id appears at least twice — once in the table of contents, once at the
 * real heading — so the longest body wins. A contents entry is one line and
 * always loses.
 */
export function findItems(fullText: string, edition: string): CorpusItem[] {
  const lines = fullText.split('\n')

  const starts: Array<{ index: number; kind: 'lab' | 'exercise'; id: string; chapter: number }> = []
  for (const [index, line] of lines.entries()) {
    const h = heading(line)
    if (h) starts.push({ index, ...h })
  }

  const best = new Map<string, CorpusItem>()

  for (const [i, start] of starts.entries()) {
    const nextHeading = starts[i + 1]?.index ?? lines.length
    let end = Math.min(nextHeading, start.index + 1 + MAX_BODY_LINES)

    // A chapter heading also terminates a body.
    for (let j = start.index + 1; j < end; j++) {
      if (CHAPTER_RE.test(lines[j] ?? '')) {
        end = j
        break
      }
    }

    const text = lines
      .slice(start.index, end)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    const item: CorpusItem = {
      id: start.id,
      kind: start.kind,
      chapter: start.chapter,
      edition,
      text,
    }

    const existing = best.get(start.id)
    if (!existing || item.text.length > existing.text.length) best.set(start.id, item)
  }

  return [...best.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
}

/** Item id to the editions containing it. Two editions means durable core material. */
export function weightSignal(items: CorpusItem[]): Record<string, string[]> {
  const byId = new Map<string, Set<string>>()
  for (const item of items) {
    const set = byId.get(item.id) ?? new Set<string>()
    set.add(item.edition)
    byId.set(item.id, set)
  }
  const out: Record<string, string[]> = {}
  for (const [id, editions] of [...byId.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], 'en', { numeric: true }),
  )) {
    out[id] = [...editions].sort()
  }
  return out
}

async function extract(pdf: string): Promise<string> {
  // pdftotext is the rootless poppler wrapper in ~/.local/bin.
  const { stdout } = await run('pdftotext', ['-layout', pdf, '-'], {
    maxBuffer: 256 * 1024 * 1024,
  })
  return stdout
}

async function main(): Promise<number> {
  const editions = [
    {
      tag: 'r9',
      pdf: '/mnt/c/Users/DaxAxisTangco/Downloads/(REFERENCE) Red Hat RHCSA 9 Cert Guide EX200.pdf',
    },
    {
      tag: 'r10',
      pdf: '/mnt/c/Users/DaxAxisTangco/Downloads/Red_Hat_RHCSA_10_Cert_Guide_EX200_ER_-_Sander_van_Vugt.pdf',
    },
  ]

  const all: CorpusItem[] = []

  for (const edition of editions) {
    const text = await extract(edition.pdf)
    const items = findItems(text, edition.tag)
    all.push(...items)

    const dir = join('corpus', edition.tag)
    await mkdir(dir, { recursive: true })

    const labs = items.filter((i) => i.kind === 'lab')
    const exercises = items.filter((i) => i.kind === 'exercise')
    await writeFile(join(dir, 'labs.json'), `${JSON.stringify(labs, null, 2)}\n`)
    await writeFile(join(dir, 'exercises.json'), `${JSON.stringify(exercises, null, 2)}\n`)

    process.stdout.write(`${edition.tag}: ${labs.length} labs, ${exercises.length} exercises\n`)
  }

  const signal = weightSignal(all)
  await writeFile('corpus/signal.json', `${JSON.stringify(signal, null, 2)}\n`)

  const both = Object.values(signal).filter((e) => e.length === 2).length
  process.stdout.write(`cross-edition items (durable core): ${both}\n`)
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 5 new tests PASS; typecheck clean.

- [ ] **Step 5: Run the extraction for real and check it against the measured counts**

Run: `cd /home/daxtangco/rhcsa-trainer && node scripts/extract-corpus.ts`

Expected output, matching the counts recorded in spec §2:
```
r9: 30 labs, 95 exercises
r10: 28 labs, 85 exercises
cross-edition items (durable core): 112
```

The cross-edition figure is 28 shared labs + 84 shared exercises. **If the lab or exercise counts differ from these, stop and investigate rather than adjusting the expectation** — these numbers were measured directly from the PDFs and a mismatch means the slicing logic is wrong.

Spot-check one extracted body:
```bash
cd /home/daxtangco/rhcsa-trainer
node --input-type=module -e "const l = JSON.parse(await (await import('node:fs/promises')).readFile('corpus/r9/labs.json','utf8')); console.log(l.find(i=>i.id==='Lab 15.1').text.slice(0,400))"
```
Expected: the real end-of-chapter lab text, not a one-line table-of-contents entry.

- [ ] **Step 6: Commit**

`corpus/` is git-ignored (Task 1) because it is regenerable output derived from copyrighted PDFs. Only the script is committed.

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add scripts/extract-corpus.ts test/corpus && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(corpus): extract labs and exercises from both editions

Longest-body-wins deduplication handles every id appearing in both the table
of contents and the real heading. signal.json records which editions contain
each item, which seeds task weight per spec section 14.4. Output stays
git-ignored: it is regenerable and derived from copyrighted PDFs."
```

---

## Part 2 — The VM and the control plane (Tasks 15–20)

These tasks touch VMware Workstation. Tasks 16, 17, 18 and 20 are written and unit-tested against fakes today; each has one clearly marked **acceptance step** that needs a running VM. Task 16's acceptance step runs against the **existing Ubuntu VM** and needs no ISO.

---

### Task 15: VM build checklist

The one document a human executes by hand. Everything after it is automated.

**Files:**
- Create: `docs/vm-build-checklist.md`
- Modify: `README.md` (link it from a "Getting started" section)

**Interfaces:**
- Consumes: nothing.
- Produces: the VM contract every later task assumes — VM name `rhcsa-lab`, `.vmx` path, study user `student`, free VG extents, BIOS firmware, NAT networking, `open-vm-tools` installed.

**Blocked on:** the RHEL 9 binary DVD ISO. Write the document now; execute it when the ISO lands.

- [ ] **Step 1: Write the checklist**

`docs/vm-build-checklist.md`:

```markdown
# RHCSA lab VM build checklist

One-time manual build. Everything after this is scripted. Budget 45 minutes.

## Before you start

Download **RHEL 9 binary DVD** (not the boot ISO — the binary DVD carries the
package payload, which lets `provision.sh` build a local `dnf` repository with
no subscription and no network):

1. Sign in at <https://developers.redhat.com/products/rhel/download> with your
   own Red Hat account. A **Red Hat Developer Subscription for Individuals** is
   free and entitles one system.
2. Download `rhel-9.x-x86_64-dvd.iso` (~10 GB).
3. Save it to `C:\ISO\` so it is reachable from both Windows and WSL at
   `/mnt/c/ISO/`.

Nothing in this project needs your Red Hat credentials. Do not put them in a
file in this repo.

## Why these settings

Every non-default choice below exists to make a specific RHCSA objective
practisable. Do not "simplify" them.

| Setting | Value | Why |
|---|---|---|
| Firmware | **BIOS**, not UEFI | GRUB recovery and `grub2-install` behave the way the exam objectives describe. UEFI changes the commands. |
| Disk | 40 GB, single file, not pre-allocated | Room for spare-disk exercises; single file keeps snapshots fast. |
| Memory | 4096 MB | Enough for containers plus a desktop-free install. |
| CPUs | 2 | `tuned` and `systemd` work is more realistic than on 1. |
| Network | **NAT (VMnet8)** | Reachable from WSL2 without bridging to your corporate LAN. Risk R1 verifies this. |
| Snapshot memory | **on** | Live snapshots restore in ~5 s. Cold boot is 30 s+. |

## 1. Create the VM

1. VMware Workstation → **File → New Virtual Machine → Custom (advanced)**.
2. Hardware compatibility: leave the default.
3. **Installer disc image file**: `C:\ISO\rhel-9.x-x86_64-dvd.iso`.
4. If VMware offers *Easy Install*, **decline it** — it creates its own
   partitioning and user, and you need custom partitioning.
5. Guest OS: **Linux → Red Hat Enterprise Linux 9 64-bit**.
6. Name: **`rhcsa-lab`**. Location: `C:\VMs\rhcsa-lab`.
7. Firmware: **BIOS**.
8. Processors: 1 processor, **2 cores**.
9. Memory: **4096 MB**.
10. Network: **NAT**.
11. I/O controller: LSI Logic (default). Disk type: **SCSI**.
12. Disk: **Create a new virtual disk**, **40 GB**, **store as a single file**,
    do **not** allocate all space now.
13. Finish. Do not power on yet.

## 2. Partition during installation

Power on. In Anaconda:

1. **Language**: English. **Time**: your zone.
2. **Software Selection**: **Server** (not "Server with GUI", not "Minimal
     Install" — Minimal omits tools several objectives need).
3. **Installation Destination** → select the 40 GB disk → **Custom** → **Done**.
4. Click **Click here to create them automatically**, then adjust to this
   layout. **This layout is not optional** — the Phase 1 LVM lab depends on it.

   | Mount point | Type | Size | Notes |
   |---|---|---|---|
   | `/boot` | standard partition, xfs | 1 GB | outside LVM, as usual |
   | `/` | LVM, xfs | 12 GB | |
   | `/home` | LVM, xfs | **8 GB** | shrinkable later — this is the lab's source |
   | `/var` | LVM, xfs | **2 GB** | **must be its own LV** — the lab grows it |
   | swap | LVM | 2 GB | |

   Total allocated ≈ 25 GB of 40 GB. **Leave the remaining ~15 GB as free
   extents in the volume group** — do not grow `/` to fill the disk. Spare
   extents are what make `lvextend`, snapshot, and new-LV exercises possible.

   Volume group name: **`rhel`** (Anaconda's default). LV names:
   `root`, `home`, `var`, `swap`.
5. **Root Password**: set one you will remember; **allow root SSH login is not
   needed** — leave it off.
6. **User Creation**: create user **`student`**, tick **"Make this user
   administrator"** (this puts them in `wheel`, which `sudo` needs).
7. Begin installation. Reboot when prompted.

## 3. First boot

Log in as `student` at the console.

1. Accept the licence if prompted.
2. Confirm the layout is what you asked for:

   ```bash
   lsblk
   sudo vgs                 # VFree should show roughly 15 GB
   sudo lvs                 # root, home, var, swap
   findmnt /var             # must show /dev/mapper/rhel-var, not /dev/mapper/rhel-root
   df -h /home /var
   getenforce               # must print Enforcing
   ```

   **If `findmnt /var` shows the root LV, `/var` was not created separately.**
   Do not continue — the Phase 1 lab cannot work. Reinstall with the correct
   layout; it is faster than fixing it afterwards.

3. Install the guest tools, which is how `vmrun` learns the guest's IP:

   ```bash
   sudo dnf install -y open-vm-tools
   sudo systemctl enable --now vmtoolsd
   ```

   `dnf` needs a repo. If the machine is unregistered and has no repo yet, mount
   the DVD (still attached) and use it:

   ```bash
   sudo mkdir -p /mnt/dvd
   sudo mount /dev/sr0 /mnt/dvd
   sudo tee /etc/yum.repos.d/dvd.repo >/dev/null <<'EOF'
   [dvd-baseos]
   name=DVD BaseOS
   baseurl=file:///mnt/dvd/BaseOS
   enabled=1
   gpgcheck=0

   [dvd-appstream]
   name=DVD AppStream
   baseurl=file:///mnt/dvd/AppStream
   enabled=1
   gpgcheck=0
   EOF
   sudo dnf install -y open-vm-tools
   ```

   `provision.sh` (Task 19) makes this repo permanent by copying the ISO into
   the VM's disk; this mount is only to get `open-vm-tools` in place.

4. Note the IP address — `provision.sh` needs it once:

   ```bash
   ip -4 addr show scope global
   ```

5. Run `scripts/guest-provision.sh` (Task 19) **from the VM console, not over
   ssh**; it will ask for `student`'s password once and never again. Its first
   act is to install `/etc/sudoers.d/rhcsa-trainer`, and after that every
   `sudo` in the guest — including every grader, setup script and solution the
   app runs — needs no password. The console is the only place that first
   prompt can be answered, which is why this step is not automated.

## 4. Verify from the WSL host

In WSL:

```bash
VMRUN='/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe'
"$VMRUN" list
"$VMRUN" getGuestIPAddress 'C:\VMs\rhcsa-lab\rhcsa-lab.vmx' -wait
ping -c 3 <that-ip>
```

If `getGuestIPAddress` reports an error, `vmtoolsd` is not running. If `ping`
fails but `vmrun list` works, that is **risk R1** — see `scripts/r1-probe.sh`
(Task 16), which enumerates the fallbacks. The project still works over the
`vmrun` transport with no networking at all, so this is not a blocker.

## 5. Snapshots

**Power the VM off first for `golden`.** A powered-off snapshot is the one you
can always fall back to.

```bash
"$VMRUN" stop 'C:\VMs\rhcsa-lab\rhcsa-lab.vmx' soft
"$VMRUN" snapshot 'C:\VMs\rhcsa-lab\rhcsa-lab.vmx' golden
```

`provision.sh` (Task 19) creates the `clean` snapshot — the live,
memory-included one used for ~5 s task resets — after it finishes configuring
the machine.

**Never delete `golden`.** It is the only way back if `clean` is captured in a
broken state.

## 6. Record the paths

Write the values you used into `.env.local` at the repo root (git-ignored):

```
RHCSA_VMX=C:\VMs\rhcsa-lab\rhcsa-lab.vmx
RHCSA_VM_IP=192.168.x.y
RHCSA_SSH_USER=student
RHCSA_GUEST_PASSWORD=<student's password>
```

Before running `provision.sh`, put `RHCSA_VMX` and `RHCSA_GUEST_PASSWORD` in
`.env.local` at the repo root. Nothing else in this project needs credentials,
and your Red Hat account password must not go in any file in this repo.

## Done

You should now have: a RHEL 9 VM named `rhcsa-lab`, `/var` on its own 2 GB LV,
`/home` on an 8 GB LV, ~15 GB of free extents in VG `rhel`, SELinux enforcing,
`open-vm-tools` running, and a powered-off `golden` snapshot.

Next: `scripts/r1-probe.sh`, then `scripts/provision.sh`.
```

- [ ] **Step 2: Add a Getting started section to the README**

Append to `README.md`:

```markdown
## Getting started

1. Build the lab VM once by hand: [`docs/vm-build-checklist.md`](docs/vm-build-checklist.md).
   You need a RHEL 9 binary DVD ISO from your own Red Hat Developer account.
2. Check that WSL can reach it: `bash scripts/r1-probe.sh`.
3. Configure it: `bash scripts/provision.sh`.
4. Check the content bank loads: `node src/cli/index.ts coverage`.
```

- [ ] **Step 3: Verify the checklist is self-consistent**

Read it start to finish and confirm three things by inspection:
- every value in the "Record the paths" section appears earlier in the document
- the partition table totals ~25 GB against a 40 GB disk, leaving free extents
- the `/var`-on-its-own-LV requirement is stated as a hard stop, since the Phase 1 lab cannot function otherwise

No automated test — this document is executed by a human.

- [ ] **Step 4: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add docs/vm-build-checklist.md README.md && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "docs: VM build checklist

Every non-default setting is justified against a specific objective. The
partition layout is a hard requirement, not a suggestion: /var must be its own
LV and the VG must keep free extents, or the Phase 1 LVM lab cannot run."
```

---

### Task 16: Answer risk R1 — can WSL2 reach a VMnet8 guest?

**This task is unblocked today.** It needs a reachable VM, not a RHEL one — the existing Ubuntu VM answers the question.

**Files:**
- Create: `scripts/r1-probe.sh`
- Create: `docs/r1-findings.md` (written by running the probe)

**Interfaces:**
- Consumes: nothing.
- Produces: the answer that decides whether `SshTransport` is the default (Task 18). If R1 fails, `VmrunTransport` becomes the primary and Task 18's `chooseTransport` still works unchanged — only its outcome differs.

- [ ] **Step 1: Write the probe**

`scripts/r1-probe.sh`:

```bash
#!/usr/bin/env bash
# Risk R1: can WSL2 reach a VMware NAT (VMnet8) guest over TCP/22?
#
# Answer this with ANY running VM. It is a question about host networking,
# not about RHEL, so the existing Ubuntu VM is a valid subject.
#
# Read-only. Starts nothing, changes nothing. Exit code is advisory:
#   0 = SSH reachable, SshTransport can be the default
#   1 = not reachable, VmrunTransport is the primary; see the fallbacks below
set -uo pipefail

VMRUN='/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe'

say() { printf '%s\n' "$*"; }
hdr() { printf '\n== %s ==\n' "$*"; }

hdr "vmrun"
if [[ ! -x "$VMRUN" ]]; then
  say "FAIL: vmrun.exe not found at:"
  say "  $VMRUN"
  say "Find it with: ls /mnt/c/Program*/VMware/VMware*/vmrun.exe"
  exit 1
fi
say "ok: $VMRUN"

hdr "running VMs"
running=$("$VMRUN" list 2>&1)
say "$running"

vmx=${1:-}
if [[ -z "$vmx" ]]; then
  # vmrun list prints a count line first, then one .vmx path per line.
  vmx=$(printf '%s\n' "$running" | grep -i '\.vmx' | head -n1 | tr -d '\r')
fi

if [[ -z "$vmx" ]]; then
  say "FAIL: no VM is running. Start one in VMware Workstation and re-run."
  say "usage: $0 ['C:\\path\\to\\vm.vmx']"
  exit 1
fi
say "subject: $vmx"

hdr "guest IP via open-vm-tools"
ip=$("$VMRUN" getGuestIPAddress "$vmx" -wait 2>&1 | tr -d '\r')
say "reported: $ip"

if [[ ! $ip =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  say "FAIL: no usable IP. open-vm-tools/vmtoolsd is probably not running in"
  say "      the guest. Install it, then re-run. Without it, only the vmrun"
  say "      transport is available - which is supported, just slower."
  exit 1
fi

hdr "WSL routing table"
ip route | sed 's/^/  /'
say ""
say "VMnet8 host adapter as WSL sees it:"
ip -4 addr show | grep -E 'inet ' | sed 's/^/  /'

hdr "ICMP"
if ping -c 3 -W 2 "$ip" >/dev/null 2>&1; then
  say "ok: ping $ip"
else
  say "warn: ping failed. Not conclusive - Windows Firewall commonly drops"
  say "      ICMP while still forwarding TCP. The port check below decides."
fi

hdr "TCP/22"
# bash's /dev/tcp needs no extra tooling, unlike nc.
if timeout 5 bash -c "exec 3<>/dev/tcp/$ip/22" 2>/dev/null; then
  say "ok: TCP/22 open on $ip"
  reachable=yes
else
  say "FAIL: cannot open TCP/22 on $ip"
  reachable=no
fi

hdr "SSH banner"
if [[ $reachable == yes ]]; then
  banner=$(timeout 5 bash -c "exec 3<>/dev/tcp/$ip/22; head -c 100 <&3" 2>/dev/null | tr -d '\r')
  say "banner: ${banner:-<none>}"
fi

hdr "verdict"
if [[ $reachable == yes ]]; then
  say "R1 RESOLVED: WSL2 can reach a VMnet8 guest on TCP/22."
  say "SshTransport is the default; VmrunTransport stays as the fallback for"
  say "tasks that deliberately break networking."
  exit 0
fi

say "R1 CONFIRMED AS A PROBLEM. Try these, in order of preference:"
say ""
say "1. Windows Firewall. The VMware NAT adapter may be classified as a"
say "   Public network, which blocks inbound. In an elevated PowerShell:"
say "     Get-NetConnectionProfile"
say "     Set-NetConnectionProfile -InterfaceAlias 'VMware Network Adapter VMnet8' \\"
say "       -NetworkCategory Private"
say ""
say "2. Guest firewalld. From the VM console:"
say "     sudo firewall-cmd --add-service=ssh --permanent && sudo firewall-cmd --reload"
say ""
say "3. NAT port forward. Workstation -> Edit -> Virtual Network Editor ->"
say "   VMnet8 -> NAT Settings -> Port Forwarding: host 2222 -> guest 22."
say "   Then SSH to 127.0.0.1:2222 instead. Set RHCSA_SSH_PORT=2222."
say ""
say "4. Bridged networking instead of NAT. Works, but exposes the VM to your"
say "   LAN - least preferred."
say ""
say "5. Do nothing. VmrunTransport uses runProgramInGuest and needs no network"
say "   at all. Grading works; the interactive terminal is the part that"
say "   suffers. This is a supported configuration, not a failure."
exit 1
```

- [ ] **Step 2: Make it executable and shellcheck it**

Run:
```bash
cd /home/daxtangco/rhcsa-trainer
chmod +x scripts/r1-probe.sh
bash -n scripts/r1-probe.sh && echo "syntax ok"
```
Expected: `syntax ok`.

- [ ] **Step 3: Verify it fails cleanly when no VM is running**

Run: `cd /home/daxtangco/rhcsa-trainer && bash scripts/r1-probe.sh; echo "exit=$?"`

If no VM is running, expected: the `vmrun` section succeeds, then `FAIL: no VM is running`, `exit=1`. The point of this step is that the script gives an actionable message instead of a bash error.

- [ ] **Step 4: ACCEPTANCE — run the probe against the existing Ubuntu VM**

Start the Ubuntu VM in VMware Workstation, then:

```bash
cd /home/daxtangco/rhcsa-trainer && bash scripts/r1-probe.sh; echo "exit=$?"
```

If the Ubuntu VM lacks `open-vm-tools`, install it there (`sudo apt install -y open-vm-tools`) or pass the IP-bearing VM's `.vmx` explicitly. If it has no `sshd`, the TCP/22 check will fail for a reason that is not R1 — install `openssh-server` in the guest first, otherwise the probe answers the wrong question.

- [ ] **Step 5: Record the finding**

Write `docs/r1-findings.md` with, at minimum:
- the date the probe was run and which VM was the subject
- the full probe output, in a fenced block
- the verdict: `SshTransport` default, or which fallback was adopted
- if a fallback was needed, the exact change made (firewall profile, port forward number, etc.) so it is reproducible after a Windows update undoes it

Then update spec §17's R1 row from a risk to a resolved finding, citing this file.

- [ ] **Step 6: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add scripts/r1-probe.sh docs/r1-findings.md docs/superpowers/specs && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "test(vm): probe WSL2 to VMnet8 reachability, resolving risk R1

Runs against any VM, so the existing Ubuntu guest answers it without waiting
for the RHEL ISO. Prints ranked fallbacks on failure, including the
do-nothing option: the vmrun transport needs no network at all."
```

---

### Task 17: `VmrunTransport` and VM lifecycle

The fallback transport and the snapshot machinery. `runProgramInGuest` works with no guest networking at all, which is exactly what troubleshooting tasks need — they break networking on purpose.

**Files:**
- Create: `src/engine/vm/vmrun.ts`
- Create: `src/engine/vm/config.ts`
- Test: `test/vm/config.test.ts`, `test/vm/vmrun.test.ts`

**Interfaces:**
- Consumes: `LabTransport`, `ExecResult`, `TransportKind` (T2).
- Produces:
  - `interface VmConfig { vmx: string; ip?: string; sshUser: string; sshPort: number; sshKey: string; vmrun: string; forceTransport?: TransportKind }`
  - `interface VmrunConfigSlice` — the exported subset of `VmConfig` that `VmrunTransport` and `VmController` actually read. Task 18 must satisfy it structurally.
  - `function loadVmConfig(env: Record<string, string | undefined>): VmConfig`
  - `type Runner = (exe: string, args: string[]) => Promise<ExecResult>` — the single injection seam; the real one wraps `execFile`
  - `class VmrunTransport implements LabTransport` — `kind = 'vmrun'`
  - `class VmController` — `power()`, `stop()`, `snapshot(name)`, `revert(name)`, `listSnapshots()`, `reboot()`, `waitForGuest()`

**Design notes.**
- `runProgramInGuest` cannot pipe stdin, so a script is delivered by writing it to a host temp file, `copyFileFromHostToGuest`, then running `bash /tmp/<name>`. Three round trips per exec — slow, which is why SSH is preferred, but it is the only path that survives broken networking.
- `vmrun` exit codes are unreliable; `VmrunTransport` reports the **guest program's** exit code, which `runProgramInGuest` surfaces on stdout as `Guest program exited with non-zero code: N`.
- `reboot()` polls `waitForGuest()` rather than sleeping a fixed interval, with a 120 s ceiling.

- [ ] **Step 1: Write the failing config test**

`test/vm/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { loadVmConfig } from '../../src/engine/vm/config.ts'

describe('loadVmConfig', () => {
  it('applies documented defaults', () => {
    const c = loadVmConfig({ RHCSA_VMX: 'C:\\VMs\\rhcsa-lab\\rhcsa-lab.vmx' })
    expect(c.vmx).toBe('C:\\VMs\\rhcsa-lab\\rhcsa-lab.vmx')
    expect(c.sshUser).toBe('student')
    expect(c.sshPort).toBe(22)
    expect(c.sshKey).toMatch(/\.ssh\/rhcsa_lab$/)
    expect(c.vmrun).toBe('/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe')
    expect(c.forceTransport).toBeUndefined()
  })

  it('honours overrides, including the R1 port-forward fallback', () => {
    const c = loadVmConfig({
      RHCSA_VMX: 'x.vmx',
      RHCSA_VM_IP: '127.0.0.1',
      RHCSA_SSH_PORT: '2222',
      RHCSA_SSH_USER: 'lab',
      RHCSA_TRANSPORT: 'vmrun',
    })
    expect(c.ip).toBe('127.0.0.1')
    expect(c.sshPort).toBe(2222)
    expect(c.sshUser).toBe('lab')
    expect(c.forceTransport).toBe('vmrun')
  })

  it('throws when RHCSA_VMX is missing, naming the file that sets it', () => {
    expect(() => loadVmConfig({})).toThrow(/RHCSA_VMX/)
    expect(() => loadVmConfig({})).toThrow(/\.env\.local/)
  })

  it('rejects an unknown forced transport rather than silently ignoring it', () => {
    expect(() => loadVmConfig({ RHCSA_VMX: 'x', RHCSA_TRANSPORT: 'telepathy' })).toThrow(
      /RHCSA_TRANSPORT/,
    )
  })

  it('rejects a non-numeric port', () => {
    expect(() => loadVmConfig({ RHCSA_VMX: 'x', RHCSA_SSH_PORT: 'ssh' })).toThrow(/RHCSA_SSH_PORT/)
  })
})
```

- [ ] **Step 2: Write the failing transport test**

`test/vm/vmrun.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ExecResult } from '../../src/engine/vm/transport.ts'
import { VmController, VmrunTransport } from '../../src/engine/vm/vmrun.ts'

const CFG = {
  vmx: 'C:\\VMs\\rhcsa-lab\\rhcsa-lab.vmx',
  sshUser: 'student',
  sshPort: 22,
  sshKey: '/home/u/.ssh/rhcsa_lab',
  vmrun: '/vmrun.exe',
}

function recorder(replies: Array<ExecResult | ((args: string[]) => ExecResult)> = []) {
  const calls: string[][] = []
  let i = 0
  const runner = async (_exe: string, args: string[]): Promise<ExecResult> => {
    calls.push(args)
    const reply = replies[i++]
    if (typeof reply === 'function') return reply(args)
    return reply ?? { stdout: '', stderr: '', code: 0 }
  }
  return { runner, calls }
}

describe('VmrunTransport', () => {
  it('reports its kind', () => {
    const r = recorder()
    expect(new VmrunTransport(CFG, r.runner).kind).toBe('vmrun')
  })

  it('copies the script into the guest, then runs it with bash', async () => {
    const r = recorder([
      { stdout: '', stderr: '', code: 0 }, // copyFileFromHostToGuest
      { stdout: 'hello\n', stderr: '', code: 0 }, // runProgramInGuest
      { stdout: '', stderr: '', code: 0 }, // cleanup
    ])
    const t = new VmrunTransport(CFG, r.runner)
    const out = await t.exec('echo hello')

    expect(out.stdout).toBe('hello\n')
    expect(out.code).toBe(0)

    expect(r.calls[0]?.[0]).toBe('copyFileFromHostToGuest')
    expect(r.calls[0]?.[1]).toBe(CFG.vmx)
    // guest destination is under /tmp and unique per exec. Asserted from the
    // end of argv, not index 3: the guest auth flags sit in between, so the
    // fixed index would land on the username.
    expect(r.calls[0]?.at(-1)).toMatch(/^\/tmp\/rhcsa-[a-z0-9]+\.sh$/)

    expect(r.calls[1]?.[0]).toBe('runProgramInGuest')
    expect(r.calls[1]).toContain('/usr/bin/bash')
  })

  it('passes guest credentials on every guest operation', async () => {
    const r = recorder()
    await new VmrunTransport(CFG, r.runner).exec('true')
    for (const call of r.calls) {
      expect(call).toContain('-gu')
      expect(call).toContain('student')
      expect(call).toContain('-gp')
    }
  })

  it('extracts the guest exit code that vmrun reports on stdout', async () => {
    // vmrun itself exits non-zero here, but the number that matters is the
    // guest program's.
    const r = recorder([
      { stdout: '', stderr: '', code: 0 },
      {
        stdout: 'Error: Guest program exited with non-zero code: 3\n',
        stderr: '',
        code: 255,
      },
      { stdout: '', stderr: '', code: 0 },
    ])
    const out = await new VmrunTransport(CFG, r.runner).exec('exit 3')
    expect(out.code).toBe(3)
  })

  it('removes the staged script even when the guest program fails', async () => {
    const r = recorder([
      { stdout: '', stderr: '', code: 0 },
      { stdout: '', stderr: 'boom', code: 1 },
      { stdout: '', stderr: '', code: 0 },
    ])
    await new VmrunTransport(CFG, r.runner).exec('false')
    const last = r.calls.at(-1)
    expect(last?.[0]).toBe('deleteFileInGuest')
  })

  it('isAvailable is true only when the vmx appears in vmrun list', async () => {
    const listed = recorder([
      { stdout: `Total running VMs: 1\n${CFG.vmx}\n`, stderr: '', code: 0 },
    ])
    expect(await new VmrunTransport(CFG, listed.runner).isAvailable()).toBe(true)

    const other = recorder([
      { stdout: 'Total running VMs: 1\nC:\\VMs\\ubuntu\\ubuntu.vmx\n', stderr: '', code: 0 },
    ])
    expect(await new VmrunTransport(CFG, other.runner).isAvailable()).toBe(false)
  })

  it('isAvailable is false rather than throwing when vmrun is missing', async () => {
    const runner = async () => {
      throw new Error('ENOENT')
    }
    expect(await new VmrunTransport(CFG, runner).isAvailable()).toBe(false)
  })

  it('matches the vmx case-insensitively, because Windows paths vary', async () => {
    const r = recorder([
      { stdout: 'Total running VMs: 1\nc:\\vms\\rhcsa-lab\\RHCSA-LAB.VMX\n', stderr: '', code: 0 },
    ])
    expect(await new VmrunTransport(CFG, r.runner).isAvailable()).toBe(true)
  })
})

describe('VmController', () => {
  it('starts the VM headless-nogui and reverts to a named snapshot', async () => {
    const r = recorder()
    const c = new VmController(CFG, r.runner)

    await c.power()
    expect(r.calls[0]).toEqual(['start', CFG.vmx, 'nogui'])

    await c.revert('clean')
    expect(r.calls[1]).toEqual(['revertToSnapshot', CFG.vmx, 'clean'])
    // Reverting leaves the VM powered off unless it was a live snapshot, so
    // the controller always starts it afterwards.
    expect(r.calls[2]).toEqual(['start', CFG.vmx, 'nogui'])
  })

  it('takes a snapshot and lists snapshots', async () => {
    const r = recorder([
      { stdout: '', stderr: '', code: 0 },
      { stdout: 'Total snapshots: 2\ngolden\nclean\n', stderr: '', code: 0 },
    ])
    const c = new VmController(CFG, r.runner)

    await c.snapshot('clean')
    expect(r.calls[0]).toEqual(['snapshot', CFG.vmx, 'clean'])

    expect(await c.listSnapshots()).toEqual(['golden', 'clean'])
  })

  it('stops the VM softly so filesystems flush', async () => {
    const r = recorder()
    await new VmController(CFG, r.runner).stop()
    expect(r.calls[0]).toEqual(['stop', CFG.vmx, 'soft'])
  })

  it('reboot waits for the guest to come back and does not sleep blindly', async () => {
    let probes = 0
    const runner = async (_e: string, args: string[]): Promise<ExecResult> => {
      if (args[0] === 'runProgramInGuest' || args[0] === 'copyFileFromHostToGuest') {
        probes += 1
        // Unreachable for the first two probes, then up.
        return probes <= 2
          ? { stdout: '', stderr: 'not connected', code: 255 }
          : { stdout: 'up\n', stderr: '', code: 0 }
      }
      return { stdout: '', stderr: '', code: 0 }
    }
    const c = new VmController(CFG, runner, { pollMs: 1, timeoutMs: 5000 })
    await c.reboot()
    expect(probes).toBeGreaterThan(2)
  })

  it('reboot throws a legible error when the guest never returns', async () => {
    const runner = async (): Promise<ExecResult> => ({ stdout: '', stderr: 'down', code: 255 })
    const c = new VmController(CFG, runner, { pollMs: 1, timeoutMs: 30 })
    await expect(c.reboot()).rejects.toThrow(/guest did not come back within 30ms/)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/vm/`
Expected: FAIL — `Cannot find module '../../src/engine/vm/vmrun.ts'` and `.../config.ts`.

- [ ] **Step 4: Write `src/engine/vm/config.ts`**

```ts
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { TransportKind } from './transport.ts'

export interface VmConfig {
  vmx: string
  ip?: string
  sshUser: string
  sshPort: number
  sshKey: string
  vmrun: string
  /** Set by RHCSA_TRANSPORT to skip probing, or by a task that needs vmrun. */
  forceTransport?: TransportKind
}

const DEFAULT_VMRUN = '/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe'
const KINDS: readonly string[] = ['ssh', 'vmrun', 'fake']

export function loadVmConfig(env: Record<string, string | undefined>): VmConfig {
  const vmx = env.RHCSA_VMX
  if (!vmx) {
    throw new Error(
      'RHCSA_VMX is not set. Put it in .env.local at the repo root, as described ' +
        'in docs/vm-build-checklist.md section 6.',
    )
  }

  const portRaw = env.RHCSA_SSH_PORT ?? '22'
  const sshPort = Number(portRaw)
  if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) {
    throw new Error(`RHCSA_SSH_PORT must be a port number, got ${JSON.stringify(portRaw)}`)
  }

  const forced = env.RHCSA_TRANSPORT
  if (forced !== undefined && !KINDS.includes(forced)) {
    throw new Error(`RHCSA_TRANSPORT must be one of ${KINDS.join(', ')}, got ${JSON.stringify(forced)}`)
  }

  return {
    vmx,
    ip: env.RHCSA_VM_IP,
    sshUser: env.RHCSA_SSH_USER ?? 'student',
    sshPort,
    sshKey: env.RHCSA_SSH_KEY ?? join(homedir(), '.ssh', 'rhcsa_lab'),
    vmrun: env.RHCSA_VMRUN ?? DEFAULT_VMRUN,
    forceTransport: forced as TransportKind | undefined,
  }
}
```

- [ ] **Step 5: Write `src/engine/vm/vmrun.ts`**

```ts
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ExecResult, LabTransport, TransportKind } from './transport.ts'

const execFileAsync = promisify(execFile)

/** The single seam that keeps every test off the real hypervisor. */
export type Runner = (exe: string, args: string[]) => Promise<ExecResult>

/** vmrun reports the guest program's exit status in prose on stdout. */
const GUEST_CODE_RE = /Guest program exited with non-zero code:\s*(\d+)/

export const realRunner: Runner = async (exe, args) => {
  try {
    const { stdout, stderr } = await execFileAsync(exe, args, { maxBuffer: 32 * 1024 * 1024 })
    return { stdout, stderr, code: 0 }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number; message?: string }
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message ?? '',
      code: typeof err.code === 'number' ? err.code : 1,
    }
  }
}

/** Fields VmrunTransport actually needs, so tests can pass a literal. */
export interface VmrunConfigSlice {
  vmx: string
  vmrun: string
  sshUser: string
}

function guestAuth(cfg: VmrunConfigSlice): string[] {
  // The guest password is only ever read from the environment, never stored in
  // the repo. Guest ops fail with a clear vmrun error if it is unset.
  return ['-gu', cfg.sshUser, '-gp', process.env.RHCSA_GUEST_PASSWORD ?? '']
}

let counter = 0
function guestScriptPath(): string {
  // Unique per exec so concurrent grading cannot clobber a staged script.
  counter += 1
  const tag = `${counter.toString(36)}${(counter * 7919).toString(36)}`
  return `/tmp/rhcsa-${tag}.sh`
}

/**
 * Runs scripts through `vmrun runProgramInGuest`.
 *
 * Slower than SSH — three vmrun round trips per exec — but it needs no guest
 * networking, which is what makes fault-injection tasks gradeable.
 */
export class VmrunTransport implements LabTransport {
  readonly kind: TransportKind = 'vmrun'
  #cfg: VmrunConfigSlice
  #run: Runner

  constructor(cfg: VmrunConfigSlice, run: Runner = realRunner) {
    this.#cfg = cfg
    this.#run = run
  }

  async exec(script: string): Promise<ExecResult> {
    const dir = await mkdtemp(join(tmpdir(), 'rhcsa-stage-'))
    const hostPath = join(dir, 'script.sh')
    const guestPath = guestScriptPath()
    await writeFile(hostPath, script, 'utf8')

    try {
      const auth = guestAuth(this.#cfg)

      await this.#run(this.#cfg.vmrun, [
        'copyFileFromHostToGuest',
        this.#cfg.vmx,
        ...auth,
        hostPath,
        guestPath,
      ])

      const result = await this.#run(this.#cfg.vmrun, [
        'runProgramInGuest',
        this.#cfg.vmx,
        ...auth,
        // No -noWait / -activeWindow / -interactive: those are bare presence
        // flags, not `=false` assignments, and blocking until the guest program
        // exits is already vmrun's default. Passing them as `flag=false` is a
        // syntax error, not a no-op.
        '/usr/bin/bash',
        guestPath,
      ])

      const reported = GUEST_CODE_RE.exec(`${result.stdout}\n${result.stderr}`)
      const code = reported ? Number(reported[1]) : result.code

      return { stdout: result.stdout, stderr: result.stderr, code }
    } finally {
      // Best effort: a leftover /tmp script is harmless, a thrown cleanup
      // error would mask the real result.
      await this.#run(this.#cfg.vmrun, [
        'deleteFileInGuest',
        this.#cfg.vmx,
        ...guestAuth(this.#cfg),
        guestPath,
      ]).catch(() => undefined)
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { stdout } = await this.#run(this.#cfg.vmrun, ['list'])
      const want = this.#cfg.vmx.toLowerCase()
      return stdout
        .split('\n')
        .map((l) => l.trim().toLowerCase())
        .includes(want)
    } catch {
      return false
    }
  }
}

export interface VmControllerOptions {
  pollMs?: number
  timeoutMs?: number
}

/**
 * Power, snapshot and reboot control. Separate from the transport because
 * lifecycle is not exec — a transport that can run a command says nothing
 * about whether we may revert the disk underneath it.
 */
export class VmController {
  #cfg: VmrunConfigSlice
  #run: Runner
  #pollMs: number
  #timeoutMs: number

  constructor(cfg: VmrunConfigSlice, run: Runner = realRunner, opts: VmControllerOptions = {}) {
    this.#cfg = cfg
    this.#run = run
    this.#pollMs = opts.pollMs ?? 2000
    this.#timeoutMs = opts.timeoutMs ?? 120_000
  }

  async power(): Promise<void> {
    await this.#run(this.#cfg.vmrun, ['start', this.#cfg.vmx, 'nogui'])
  }

  async stop(): Promise<void> {
    // soft = ACPI shutdown, so filesystems flush. hard would corrupt the
    // very persistence the graders check.
    await this.#run(this.#cfg.vmrun, ['stop', this.#cfg.vmx, 'soft'])
  }

  async snapshot(name: string): Promise<void> {
    await this.#run(this.#cfg.vmrun, ['snapshot', this.#cfg.vmx, name])
  }

  async revert(name: string): Promise<void> {
    await this.#run(this.#cfg.vmrun, ['revertToSnapshot', this.#cfg.vmx, name])
    // A live snapshot resumes running; a powered-off one does not. start is
    // idempotent, so call it either way.
    await this.power()
  }

  async listSnapshots(): Promise<string[]> {
    const { stdout } = await this.#run(this.#cfg.vmrun, ['listSnapshots', this.#cfg.vmx])
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !/^Total snapshots:/i.test(l))
  }

  /** True when a trivial command runs in the guest. */
  async guestUp(): Promise<boolean> {
    const t = new VmrunTransport(this.#cfg, this.#run)
    try {
      const r = await t.exec('echo up')
      return r.code === 0
    } catch {
      return false
    }
  }

  async waitForGuest(): Promise<void> {
    const deadline = Date.now() + this.#timeoutMs
    for (;;) {
      if (await this.guestUp()) return
      if (Date.now() >= deadline) {
        throw new Error(`guest did not come back within ${this.#timeoutMs}ms`)
      }
      await new Promise((r) => setTimeout(r, this.#pollMs))
    }
  }

  /**
   * Reboot and block until the guest answers again.
   *
   * `systemctl reboot` kills the connection mid-command, so a non-zero result
   * here is expected and ignored; waitForGuest is the real assertion.
   */
  async reboot(): Promise<void> {
    const t = new VmrunTransport(this.#cfg, this.#run)
    await t.exec('sudo systemctl reboot || sudo reboot').catch(() => undefined)
    // Give the machine a moment to actually go down, or the first probe can
    // succeed against the still-running pre-reboot system.
    await new Promise((r) => setTimeout(r, this.#pollMs))
    await this.waitForGuest()
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 5 config tests + 13 vmrun tests PASS; typecheck clean.

If the "reboot waits" test hangs, the `pollMs: 1` injection is not being honoured — check that `VmController` passes its own runner into the `VmrunTransport` it constructs, otherwise the probe hits the real `vmrun`.

- [ ] **Step 7: ACCEPTANCE (deferred until the VM exists)**

With `rhcsa-lab` built and running, and `RHCSA_GUEST_PASSWORD` exported in the shell:

```bash
cd /home/daxtangco/rhcsa-trainer
node --input-type=module -e "
import { loadVmConfig } from './src/engine/vm/config.ts'
import { VmController, VmrunTransport } from './src/engine/vm/vmrun.ts'
const cfg = loadVmConfig(process.env)
const t = new VmrunTransport(cfg)
console.log('available:', await t.isAvailable())
console.log(await t.exec('hostname; id -un; getenforce'))
console.log('snapshots:', await new VmController(cfg).listSnapshots())
"
```

Expected: `available: true`; the guest hostname, `student`, and `Enforcing`; and a snapshot list containing `golden`.

- [ ] **Step 8: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/engine/vm test/vm && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(vm): VmrunTransport and VM lifecycle control

A single injected Runner keeps every test off the hypervisor. The guest exit
code is parsed out of vmrun's prose because vmrun's own exit status is not
trustworthy. reboot polls for the guest instead of sleeping, and stop is soft
so filesystems flush - a hard stop would corrupt the persistence the graders
are there to check."
```

---

### Task 18: `SshTransport` and transport selection

The primary transport, plus the selector that makes the dual control plane automatic.

**Files:**
- Create: `src/engine/vm/ssh.ts`
- Create: `src/engine/vm/select.ts`
- Test: `test/vm/ssh.test.ts`, `test/vm/select.test.ts`

**Interfaces:**
- Consumes: `LabTransport`, `ExecResult` (T2); `VmConfig`, `VmrunTransport` (T17). Note it does **not** consume `Runner` or `realRunner`: `ssh.ts` spawns `ssh` itself and `select.ts` imports neither.
- Produces:
  - `class SshTransport implements LabTransport` — `kind = 'ssh'`
  - `class NoTransportError extends Error`
  - `function chooseTransport(cfg: VmConfig, opts?: ChooseOptions): Promise<LabTransport>`
  - `interface ChooseOptions { ssh?: LabTransport; vmrun?: LabTransport; require?: TransportKind }`

**Design notes.**
- The script goes to `ssh` on **stdin**, not as an argv argument. Quoting a multi-line bash script through argv is the classic source of grading bugs where a `$` or a newline changes meaning.
- SSH options are pinned: `BatchMode=yes` (never prompt — a hung prompt looks like a hung grader), `StrictHostKeyChecking=accept-new`, and a dedicated `UserKnownHostsFile` so reverting snapshots does not trip host-key warnings on the user's real `known_hosts`.
- **`BatchMode=yes` is correct rather than accidentally correct, and it stays.** With `/etc/sudoers.d/rhcsa-trainer` in place (see the Global Constraints and Task 19), the guest never has a legitimate reason to prompt for anything. So any password prompt means the drop-in is missing, and `BatchMode` turns that into a fast, clean, diagnosable failure instead of a hang that looks like a slow grader.
- `chooseTransport` probes with a **3 s** ceiling. A task can pin `require: 'vmrun'` — that is how fault-injection tasks stay gradeable after they break networking.

- [ ] **Step 1: Write the failing SSH test**

`test/vm/ssh.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ExecResult } from '../../src/engine/vm/transport.ts'
import { SshTransport } from '../../src/engine/vm/ssh.ts'

const CFG = {
  ip: '192.168.226.128',
  sshUser: 'student',
  sshPort: 22,
  sshKey: '/home/u/.ssh/rhcsa_lab',
}

function recorder(reply: ExecResult = { stdout: '', stderr: '', code: 0 }) {
  const calls: Array<{ exe: string; args: string[]; stdin?: string }> = []
  const runner = async (exe: string, args: string[], stdin?: string): Promise<ExecResult> => {
    calls.push({ exe, args, stdin })
    return reply
  }
  return { runner, calls }
}

describe('SshTransport', () => {
  it('reports its kind', () => {
    expect(new SshTransport(CFG, recorder().runner).kind).toBe('ssh')
  })

  it('sends the script on stdin, never as an argv argument', async () => {
    // Passing a multi-line script through argv is how quoting bugs get into
    // graders. stdin has no quoting rules at all.
    const r = recorder()
    const script = "set -euo pipefail\necho 'it$works'\n"
    await new SshTransport(CFG, r.runner).exec(script)

    expect(r.calls[0]?.stdin).toBe(script)
    expect(r.calls[0]?.args.join(' ')).not.toContain('it$works')
    expect(r.calls[0]?.args.at(-1)).toBe('bash -s')
  })

  it('pins the SSH options that keep a grader from hanging', async () => {
    const r = recorder()
    await new SshTransport(CFG, r.runner).exec('true')
    const args = r.calls[0]?.args.join(' ') ?? ''

    expect(args).toContain('BatchMode=yes')
    expect(args).toContain('StrictHostKeyChecking=accept-new')
    expect(args).toContain('ConnectTimeout=10')
    // A dedicated known_hosts file, so snapshot reverts never touch the user's.
    expect(args).toMatch(/UserKnownHostsFile=\S*rhcsa/)
    expect(args).toContain('-i /home/u/.ssh/rhcsa_lab')
    expect(args).toContain('-p 22')
    expect(args).toContain('student@192.168.226.128')
  })

  it('honours a non-default port, for the R1 port-forward fallback', async () => {
    const r = recorder()
    await new SshTransport({ ...CFG, ip: '127.0.0.1', sshPort: 2222 }, r.runner).exec('true')
    const args = r.calls[0]?.args.join(' ') ?? ''
    expect(args).toContain('-p 2222')
    expect(args).toContain('student@127.0.0.1')
  })

  it('returns the remote exit code and both streams verbatim', async () => {
    const r = recorder({ stdout: 'out', stderr: 'err', code: 7 })
    const out = await new SshTransport(CFG, r.runner).exec('exit 7')
    expect(out).toEqual({ stdout: 'out', stderr: 'err', code: 7 })
  })

  it('isAvailable is true when a probe command succeeds', async () => {
    const r = recorder({ stdout: 'ok\n', stderr: '', code: 0 })
    expect(await new SshTransport(CFG, r.runner).isAvailable()).toBe(true)
  })

  it('isAvailable is false when the probe fails or throws', async () => {
    expect(
      await new SshTransport(CFG, recorder({ stdout: '', stderr: 'refused', code: 255 }).runner).isAvailable(),
    ).toBe(false)

    const thrower = async () => {
      throw new Error('ENOENT: ssh not installed')
    }
    expect(await new SshTransport(CFG, thrower).isAvailable()).toBe(false)
  })

  it('isAvailable is false with no IP, without attempting a connection', async () => {
    const r = recorder()
    const t = new SshTransport({ ...CFG, ip: undefined }, r.runner)
    expect(await t.isAvailable()).toBe(false)
    expect(r.calls).toHaveLength(0)
  })

  it('exec throws a legible error with no IP', async () => {
    const t = new SshTransport({ ...CFG, ip: undefined }, recorder().runner)
    await expect(t.exec('true')).rejects.toThrow(/no IP/)
  })
})
```

- [ ] **Step 2: Write the failing selection test**

`test/vm/select.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { FakeTransport } from '../../src/engine/vm/fake.ts'
import { NoTransportError, chooseTransport } from '../../src/engine/vm/select.ts'
import type { VmConfig } from '../../src/engine/vm/config.ts'

const CFG: VmConfig = {
  vmx: 'x.vmx',
  ip: '10.0.0.1',
  sshUser: 'student',
  sshPort: 22,
  sshKey: '/k',
  vmrun: '/vmrun.exe',
}

/** A stand-in whose availability is fixed at construction. */
function stub(kind: 'ssh' | 'vmrun', available: boolean) {
  const t = new FakeTransport(() => ({ stdout: '', stderr: '', code: 0 }))
  return Object.assign(t, {
    kind,
    isAvailable: async () => available,
  })
}

describe('chooseTransport', () => {
  it('prefers ssh when it is available', async () => {
    const t = await chooseTransport(CFG, {
      ssh: stub('ssh', true),
      vmrun: stub('vmrun', true),
    })
    expect(t.kind).toBe('ssh')
  })

  it('falls back to vmrun when ssh is down', async () => {
    // This is the whole point of the dual control plane: a task that breaks
    // networking is still gradeable.
    const t = await chooseTransport(CFG, {
      ssh: stub('ssh', false),
      vmrun: stub('vmrun', true),
    })
    expect(t.kind).toBe('vmrun')
  })

  it('honours require: vmrun without probing ssh at all', async () => {
    let probed = false
    const ssh = stub('ssh', true)
    ssh.isAvailable = async () => {
      probed = true
      return true
    }
    const t = await chooseTransport(CFG, { ssh, vmrun: stub('vmrun', true), require: 'vmrun' })
    expect(t.kind).toBe('vmrun')
    expect(probed).toBe(false)
  })

  it('honours cfg.forceTransport', async () => {
    const t = await chooseTransport(
      { ...CFG, forceTransport: 'vmrun' },
      { ssh: stub('ssh', true), vmrun: stub('vmrun', true) },
    )
    expect(t.kind).toBe('vmrun')
  })

  it('require beats cfg.forceTransport, because a task knows what it needs', async () => {
    const t = await chooseTransport(
      { ...CFG, forceTransport: 'ssh' },
      { ssh: stub('ssh', true), vmrun: stub('vmrun', true), require: 'vmrun' },
    )
    expect(t.kind).toBe('vmrun')
  })

  it('throws NoTransportError when a required transport is unavailable', async () => {
    await expect(
      chooseTransport(CFG, { ssh: stub('ssh', false), vmrun: stub('vmrun', true), require: 'ssh' }),
    ).rejects.toThrow(NoTransportError)
  })

  it('throws NoTransportError naming both attempts when neither works', async () => {
    const p = chooseTransport(CFG, { ssh: stub('ssh', false), vmrun: stub('vmrun', false) })
    await expect(p).rejects.toThrow(NoTransportError)
    await expect(p).rejects.toThrow(/ssh/)
    await expect(p).rejects.toThrow(/vmrun/)
    // The message has to tell the user what to do, not just what failed.
    await expect(p).rejects.toThrow(/vm-build-checklist/)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/vm/ssh.test.ts test/vm/select.test.ts`
Expected: FAIL — both modules missing.

- [ ] **Step 4: Write `src/engine/vm/ssh.ts`**

```ts
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ExecResult, LabTransport, TransportKind } from './transport.ts'

/** Like Runner, but with stdin — the reason SSH gets its own seam. */
export type SshRunner = (exe: string, args: string[], stdin?: string) => Promise<ExecResult>

export const realSshRunner: SshRunner = (exe, args, stdin) =>
  new Promise((resolve) => {
    const child = execFile(
      exe,
      args,
      { maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as { code?: unknown }).code === 'number'
            ? (err as { code: number }).code
            : err
              ? 1
              : 0
        resolve({ stdout, stderr, code })
      },
    )
    if (stdin !== undefined) {
      child.stdin?.end(stdin)
    }
  })

export interface SshConfigSlice {
  ip?: string
  sshUser: string
  sshPort: number
  sshKey: string
}

/** Separate from the user's known_hosts: snapshot reverts change host keys. */
const KNOWN_HOSTS = join(homedir(), '.ssh', 'rhcsa_known_hosts')

export class SshTransport implements LabTransport {
  readonly kind: TransportKind = 'ssh'
  #cfg: SshConfigSlice
  #run: SshRunner

  constructor(cfg: SshConfigSlice, run: SshRunner = realSshRunner) {
    this.#cfg = cfg
    this.#run = run
  }

  #args(): string[] {
    if (!this.#cfg.ip) {
      throw new Error(
        'SshTransport has no IP. Set RHCSA_VM_IP in .env.local, or let the vmrun ' +
          'transport handle it.',
      )
    }
    return [
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      `UserKnownHostsFile=${KNOWN_HOSTS}`,
      '-o',
      'ConnectTimeout=10',
      '-o',
      'LogLevel=ERROR',
      '-i',
      this.#cfg.sshKey,
      '-p',
      String(this.#cfg.sshPort),
      `${this.#cfg.sshUser}@${this.#cfg.ip}`,
      // Read the script from stdin, so nothing about it is ever quoted.
      'bash -s',
    ]
  }

  async exec(script: string): Promise<ExecResult> {
    return await this.#run('ssh', this.#args(), script)
  }

  async isAvailable(): Promise<boolean> {
    if (!this.#cfg.ip) return false
    try {
      const r = await this.#run('ssh', this.#args(), 'echo rhcsa-probe\n')
      return r.code === 0
    } catch {
      return false
    }
  }
}
```

Note: `ConnectTimeout=10` is SSH's own ceiling for the connect phase. The 3 s probe ceiling in `chooseTransport` is separate and shorter — it bounds how long *selection* may take, so a dead network does not stall the UI.

- [ ] **Step 5: Write `src/engine/vm/select.ts`**

```ts
import type { VmConfig } from './config.ts'
import { SshTransport } from './ssh.ts'
import type { LabTransport, TransportKind } from './transport.ts'
import { VmrunTransport } from './vmrun.ts'

export class NoTransportError extends Error {
  readonly attempted: TransportKind[]

  constructor(attempted: TransportKind[]) {
    super(
      `no usable transport to the lab VM (tried: ${attempted.join(', ')}).\n` +
        '  - is the VM running?   vmrun.exe list\n' +
        '  - is vmtoolsd running in the guest?\n' +
        '  - for ssh, check RHCSA_VM_IP and that the key in RHCSA_SSH_KEY is authorized\n' +
        '  - see docs/vm-build-checklist.md and docs/r1-findings.md',
    )
    this.name = 'NoTransportError'
    this.attempted = attempted
  }
}

export interface ChooseOptions {
  /** Injected in tests; constructed from cfg otherwise. */
  ssh?: LabTransport
  vmrun?: LabTransport
  /**
   * Pin a transport. Set from a task's `transport:` field — fault-injection
   * tasks require vmrun because they deliberately break networking.
   */
  require?: TransportKind
  probeTimeoutMs?: number
}

/** Bound how long selection may take, independent of SSH's own ConnectTimeout. */
const PROBE_TIMEOUT_MS = 3000

async function availableWithin(t: LabTransport, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  try {
    return await Promise.race([t.isAvailable(), timeout])
  } catch {
    return false
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * SSH when it works, vmrun when it does not.
 *
 * `require` wins over `cfg.forceTransport`: the environment states a
 * preference, a task states a requirement.
 */
export async function chooseTransport(
  cfg: VmConfig,
  opts: ChooseOptions = {},
): Promise<LabTransport> {
  const ms = opts.probeTimeoutMs ?? PROBE_TIMEOUT_MS
  const ssh = opts.ssh ?? new SshTransport(cfg)
  const vmrun = opts.vmrun ?? new VmrunTransport(cfg)

  const pinned = opts.require ?? cfg.forceTransport
  if (pinned === 'ssh' || pinned === 'vmrun') {
    const t = pinned === 'ssh' ? ssh : vmrun
    if (await availableWithin(t, ms)) return t
    throw new NoTransportError([pinned])
  }

  if (await availableWithin(ssh, ms)) return ssh
  if (await availableWithin(vmrun, ms)) return vmrun
  throw new NoTransportError(['ssh', 'vmrun'])
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 9 ssh tests + 7 select tests PASS; typecheck clean.

- [ ] **Step 7: ACCEPTANCE (deferred until the VM exists)**

Depends on Task 19 having installed the key. With the VM running:

```bash
cd /home/daxtangco/rhcsa-trainer
node --input-type=module -e "
import { loadVmConfig } from './src/engine/vm/config.ts'
import { chooseTransport } from './src/engine/vm/select.ts'
const t = await chooseTransport(loadVmConfig(process.env))
console.log('chose:', t.kind)
console.log((await t.exec('hostnamectl --static; findmnt -no SOURCE /var')).stdout)
"
```

Expected: `chose: ssh` (or `vmrun` if R1 was unresolved — both are correct outcomes), then the hostname and `/dev/mapper/rhel-var`.

Then prove the fallback for real, which is the claim that matters:

```bash
# From the VM console, not over SSH - this deliberately cuts the connection:
#   sudo systemctl stop sshd
# Then, back in WSL:
node --input-type=module -e "
import { loadVmConfig } from './src/engine/vm/config.ts'
import { chooseTransport } from './src/engine/vm/select.ts'
const t = await chooseTransport(loadVmConfig(process.env))
console.log('chose:', t.kind)   // must be vmrun
console.log((await t.exec('systemctl is-active sshd')).stdout)
"
# Then restore it from the console: sudo systemctl start sshd
```

Expected: `chose: vmrun`, and `inactive`. If this step does not produce `vmrun`, the dual control plane is not real and the troubleshooting task family in Phase 2 cannot be built — stop and fix it here.

- [ ] **Step 8: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/engine/vm/ssh.ts src/engine/vm/select.ts test/vm && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(vm): SshTransport and automatic transport selection

Scripts go over stdin as 'bash -s', so nothing in a grader is ever quoted
through argv. BatchMode=yes means a missing key fails instead of hanging on a
prompt, and a dedicated known_hosts file keeps snapshot reverts from tripping
host-key warnings. A task's require: wins over the environment's preference,
which is what keeps fault-injection tasks gradeable."
```

---

### Task 19: `provision.sh` — configure the VM and capture the `clean` snapshot

Everything the checklist did not do by hand. Runs once, idempotently, from WSL.

**Files:**
- Create: `scripts/provision.sh`
- Create: `scripts/guest-provision.sh` (the part that runs inside the VM)
- Create: `.env.local` — a commented template, written only if absent, git-ignored and never committed

**Interfaces:**
- Consumes: `.env.local` (T15 §6); `vmrun.exe`.
- Produces: the `clean` **live** snapshot every task reset reverts to; the SSH key at `~/.ssh/rhcsa_lab`; the ISO-backed local `dnf` repo; `/etc/sudoers.d/rhcsa-trainer`, which is what makes every guest-side `sudo` in the whole project non-interactive; **zero spare disks** attached.

**Blocked on:** the VM existing.

**Design notes.**
- **Zero spare disks in Phase 1.** The Phase 1 task set works entirely inside the existing VG's free extents. Adding spare disks now means capturing them into `clean`, and a spare disk with stale partition tables makes later exercises non-deterministic. Phase 2 adds them with `vmware-vdiskmanager` when a task needs one.
- The local repo is ISO-backed and **copied into the VM's own disk**, not a host mount. A host-mounted ISO disappears if the `.vmx` CD-ROM device is detached, and then every `dnf` in every task fails.
- `clean` is captured **with memory, while running** — that is what makes resets ~5 s.
- The script never handles Red Hat credentials. `subscription-manager` is not run at all.
- **Passwordless `sudo` is arranged here, and nothing in the project works without it.** Both transports connect as `student`, and every grader, setup script, solution and anti-solution calls `sudo` on a connection with no TTY. RHEL 9's default `%wheel ALL=(ALL) ALL` would prompt, and since the script itself arrives on ssh's stdin the prompt would consume the rest of it — so correct student work would grade as failure on every task in the bank. Enabling root SSH was rejected in Task 15 for good reason, and there is no way to answer a `sudo` prompt when the script *is* stdin. A NOPASSWD drop-in for one unprivileged account in a disposable local lab VM is the standard arrangement, and it is also what the real exam gives you: on the RHCSA you get the root password, not a sudo prompt to fight.

- [ ] **Step 1: Write `scripts/guest-provision.sh`**

This runs inside the VM. It is delivered over the transport, so it must be idempotent.

```bash
#!/usr/bin/env bash
# Runs INSIDE the lab VM. Idempotent: safe to run repeatedly.
#
# Delivered by scripts/provision.sh. Needs a working sudo, which the checklist
# guaranteed by putting `student` in wheel.
set -euo pipefail

log() { printf '[guest] %s\n' "$*"; }

# --------------------------------------------------------- 0. sudo, no TTY
# Everything after this point — and every grader, setup script and solution the
# app will ever run — reaches root through sudo with no TTY to answer a prompt.
# RHEL 9's default %wheel rule asks for a password, and because our scripts
# arrive on ssh's stdin, sudo's prompt would eat the rest of the script and the
# failure would look like a broken grader. So: install the rule, validate it,
# and prove it works before continuing.
printf 'student ALL=(ALL) NOPASSWD: ALL\n' | sudo tee /etc/sudoers.d/rhcsa-trainer >/dev/null
sudo chmod 0440 /etc/sudoers.d/rhcsa-trainer
sudo visudo -cf /etc/sudoers.d/rhcsa-trainer   # a malformed drop-in can lock out sudo entirely
sudo -n true || { echo "FATAL: passwordless sudo is not in effect for student" >&2; exit 1; }
log "passwordless sudo installed and verified"

# ---------------------------------------------------------------- ssh key
PUBKEY=${RHCSA_PUBKEY:?RHCSA_PUBKEY must be passed in}
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
chmod 600 "$HOME/.ssh/authorized_keys"
if ! grep -qxF "$PUBKEY" "$HOME/.ssh/authorized_keys"; then
  printf '%s\n' "$PUBKEY" >> "$HOME/.ssh/authorized_keys"
  log "installed trainer public key"
else
  log "trainer public key already present"
fi
# SELinux mislabels a hand-made ~/.ssh, and then sshd silently refuses the key.
# This is the single most common cause of "key installed but still prompted".
sudo restorecon -R "$HOME/.ssh"

# ------------------------------------------------------------- local repo
# An ISO-backed repo inside the VM's own disk. No subscription, no network,
# and it cannot vanish when the CD-ROM device is detached.
ISO_MNT=/var/lib/rhcsa-repo
if ! mountpoint -q "$ISO_MNT"; then
  if [[ -f /var/lib/rhcsa-dvd.iso ]]; then
    sudo mkdir -p "$ISO_MNT"
    # fstab entry makes it survive reboots, which the grader's verdict B needs.
    if ! grep -q "$ISO_MNT" /etc/fstab; then
      echo "/var/lib/rhcsa-dvd.iso $ISO_MNT iso9660 loop,ro,nofail 0 0" | sudo tee -a /etc/fstab >/dev/null
    fi
    sudo systemctl daemon-reload
    sudo mount "$ISO_MNT"
    log "mounted local DVD image at $ISO_MNT"
  else
    log "WARNING: /var/lib/rhcsa-dvd.iso is missing; skipping local repo"
  fi
fi

if mountpoint -q "$ISO_MNT"; then
  sudo tee /etc/yum.repos.d/rhcsa-local.repo >/dev/null <<EOF
[rhcsa-baseos]
name=RHCSA local BaseOS
baseurl=file://$ISO_MNT/BaseOS
enabled=1
gpgcheck=0

[rhcsa-appstream]
name=RHCSA local AppStream
baseurl=file://$ISO_MNT/AppStream
enabled=1
gpgcheck=0
EOF
  log "wrote /etc/yum.repos.d/rhcsa-local.repo"
fi

# -------------------------------------------------------------- packages
# Only what the Phase 1 tasks and the graders need. Deliberately short: every
# package pre-installed here is one the exam might expect you to install
# yourself, so this list stays minimal on purpose.
PKGS=(
  open-vm-tools   # how vmrun learns the guest IP
  policycoreutils-python-utils  # semanage, needed to *check* SELinux contexts
  lvm2
  xfsprogs
  e2fsprogs
  bash-completion
  vim-enhanced
  man-db
  tar
  psmisc
)
sudo dnf install -y "${PKGS[@]}"
sudo systemctl enable --now vmtoolsd

# --------------------------------------------------------------- hygiene
sudo hostnamectl set-hostname rhcsa-lab
sudo systemctl enable --now sshd

# The graders never read shell history, but a student reading their own history
# after a reset is confusing, so start each snapshot from empty.
: > "$HOME/.bash_history" || true
history -c 2>/dev/null || true

# ---------------------------------------------------------------- report
log "--- state ---"
getenforce
findmnt -no SOURCE /var
sudo vgs --noheadings -o vg_name,vg_free
sudo lvs --noheadings -o lv_name,lv_size
lsblk -no NAME,SIZE,TYPE
log "guest provisioning complete"
```

The bootstrap sequencing is the one subtlety. This script's *own* `sudo` calls still need a password the first time, because the drop-in it installs does not exist yet. That is why Task 15's checklist tells the user to run it once from the VM console, where a password prompt is answerable. Every run after that — including every run `provision.sh` drives over `vmrun` — is silent.

- [ ] **Step 2: Write `scripts/provision.sh`**

```bash
#!/usr/bin/env bash
# Configure the lab VM from WSL and capture the `clean` snapshot.
#
# Idempotent. Run it again after changing guest-provision.sh; it will re-run
# the guest part and re-capture `clean`.
#
# Never touches your Red Hat credentials. subscription-manager is not used.
set -euo pipefail

cd "$(dirname "$0")/.."

# ------------------------------------------------------------------ 0. env
# Nothing earlier in the plan can create .env.local usefully: RHCSA_VM_IP is
# discovered by provisioning, and RHCSA_VMX and RHCSA_GUEST_PASSWORD are known
# only to the user. So this is the first place with a real value to write, and
# it writes a commented template with every key present and only the discovered
# ones filled. The `:?` guards below then name exactly what is still missing.
if [[ ! -f .env.local ]]; then
  cat > .env.local <<'EOF'
# Local lab configuration. Git-ignored. Never commit this file.
#
# Only you can supply these two - see docs/vm-build-checklist.md:
RHCSA_VMX=
RHCSA_GUEST_PASSWORD=
#
# Discovered by scripts/provision.sh; leave blank and it will fill this in:
RHCSA_VM_IP=
#
# Optional overrides; the defaults are usually right:
RHCSA_SSH_USER=student
#RHCSA_SSH_PORT=22
#RHCSA_SSH_KEY=
#RHCSA_TRANSPORT=
#RHCSA_ISO=
EOF
  echo "wrote a template .env.local - fill in RHCSA_VMX and RHCSA_GUEST_PASSWORD, then re-run"
fi

# shellcheck disable=SC1091
[[ -f .env.local ]] && set -a && . ./.env.local && set +a

: "${RHCSA_VMX:?set RHCSA_VMX in .env.local - see docs/vm-build-checklist.md}"
: "${RHCSA_GUEST_PASSWORD:?set RHCSA_GUEST_PASSWORD (the student password) in .env.local - see docs/vm-build-checklist.md}"
VMRUN=${RHCSA_VMRUN:-'/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe'}
SSH_USER=${RHCSA_SSH_USER:-student}
KEY=${RHCSA_SSH_KEY:-$HOME/.ssh/rhcsa_lab}
ISO=${RHCSA_ISO:-/mnt/c/ISO/rhel-9.6-x86_64-dvd.iso}

log() { printf '\n[provision] %s\n' "$*"; }
guest() { "$VMRUN" "$1" "$RHCSA_VMX" -gu "$SSH_USER" -gp "$RHCSA_GUEST_PASSWORD" "${@:2}"; }

# ------------------------------------------------------------------ 1. key
log "SSH key"
if [[ ! -f $KEY ]]; then
  mkdir -p "$(dirname "$KEY")"
  ssh-keygen -t ed25519 -N '' -C 'rhcsa-trainer' -f "$KEY"
  echo "generated $KEY"
else
  echo "reusing $KEY"
fi
PUBKEY=$(cat "$KEY.pub")

# ---------------------------------------------------------------- 2. power
log "power on"
"$VMRUN" start "$RHCSA_VMX" nogui || true
"$VMRUN" getGuestIPAddress "$RHCSA_VMX" -wait

# --------------------------------------------------------- 3. spare disks
# Deliberately none. See the design note in this task: a spare disk captured
# into `clean` carries stale partition tables into every future reset. Phase 2
# attaches them per-task with vmware-vdiskmanager.
log "spare disks: none by design (Phase 1)"

# ------------------------------------------------------------------ 4. ISO
log "local repo payload"
if [[ -f $ISO ]]; then
  # ~10 GB, so only copy it once.
  if guest runProgramInGuest /usr/bin/test -f /var/lib/rhcsa-dvd.iso 2>/dev/null; then
    echo "guest already has /var/lib/rhcsa-dvd.iso"
  else
    echo "copying $ISO into the guest (this takes several minutes)"
    guest copyFileFromHostToGuest "$ISO" /tmp/rhcsa-dvd.iso
    guest runProgramInGuest /usr/bin/bash -c \
      "sudo mv /tmp/rhcsa-dvd.iso /var/lib/rhcsa-dvd.iso && sudo chmod 0444 /var/lib/rhcsa-dvd.iso"
  fi
else
  echo "WARNING: $ISO not found. Set RHCSA_ISO. Skipping the local repo -"
  echo "         dnf will not work in the guest until this is fixed."
fi

# ---------------------------------------------------------------- 5. guest
log "guest provisioning"
guest copyFileFromHostToGuest scripts/guest-provision.sh /tmp/guest-provision.sh
guest runProgramInGuest /usr/bin/bash -c \
  "RHCSA_PUBKEY='$PUBKEY' bash /tmp/guest-provision.sh"
guest deleteFileInGuest /tmp/guest-provision.sh || true

# ------------------------------------------------------------------ 6. ssh
log "SSH check"
IP=$("$VMRUN" getGuestIPAddress "$RHCSA_VMX" -wait | tr -d '\r')
if ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
       -o UserKnownHostsFile="$HOME/.ssh/rhcsa_known_hosts" \
       -i "$KEY" "$SSH_USER@$IP" 'echo ssh-ok' 2>/dev/null | grep -q ssh-ok; then
  echo "ssh works: $SSH_USER@$IP"
  if ! grep -q '^RHCSA_VM_IP=' .env.local 2>/dev/null; then
    echo "RHCSA_VM_IP=$IP" >> .env.local
    echo "recorded RHCSA_VM_IP in .env.local"
  fi
else
  echo "ssh did NOT work. The vmrun transport still functions, so this is not"
  echo "fatal. See docs/r1-findings.md for the ranked fallbacks."
fi

# ------------------------------------------------------------ 7. snapshot
log "clean snapshot"
existing=$("$VMRUN" listSnapshots "$RHCSA_VMX" | tr -d '\r')
printf '%s\n' "$existing" | sed 's/^/  /'

if printf '%s\n' "$existing" | grep -qx 'golden'; then
  echo "golden present - good, that is the fallback of last resort"
else
  echo "WARNING: no 'golden' snapshot. Create one from a powered-off state:"
  echo "  \"\$VMRUN\" stop '$RHCSA_VMX' soft && \"\$VMRUN\" snapshot '$RHCSA_VMX' golden"
fi

if printf '%s\n' "$existing" | grep -qx 'clean'; then
  echo "replacing the existing 'clean' snapshot"
  "$VMRUN" deleteSnapshot "$RHCSA_VMX" clean
fi

# Taken WHILE RUNNING, so memory is included and reverts take ~5s instead of
# a 30s+ cold boot. This is the single biggest factor in how many tasks get
# attempted per session.
"$VMRUN" snapshot "$RHCSA_VMX" clean
echo "captured 'clean' (live, memory included)"

log "done"
echo "verify a revert round-trip:"
echo "  \"\$VMRUN\" revertToSnapshot '$RHCSA_VMX' clean && \"\$VMRUN\" start '$RHCSA_VMX' nogui"
```

- [ ] **Step 3: Syntax-check both scripts**

Run:
```bash
cd /home/daxtangco/rhcsa-trainer
chmod +x scripts/provision.sh scripts/guest-provision.sh
bash -n scripts/provision.sh && bash -n scripts/guest-provision.sh && echo "syntax ok"
```
Expected: `syntax ok`.

- [ ] **Step 4: Verify the guardrails fire without a VM**

Run: `cd /home/daxtangco/rhcsa-trainer && bash scripts/provision.sh; echo "exit=$?"`

There are two outcomes and both are correct, so know which one you are looking at. If `.env.local` is **absent**, the script writes the template, prints `wrote a template .env.local`, and then stops at `set RHCSA_VMX in .env.local`. If `.env.local` is **present** but the password is blank — the common case, because Task 15 §6 tells the user to fill in the paths — it gets past `RHCSA_VMX` and stops at `set RHCSA_GUEST_PASSWORD (the student password) in .env.local` instead. Either way it stops at the *first* missing variable with a message naming `.env.local` and `docs/vm-build-checklist.md` — not a bash error, and **not** a half-provisioned VM.

- [ ] **Step 5: ACCEPTANCE (deferred until the VM exists)**

```bash
cd /home/daxtangco/rhcsa-trainer
read -rsp 'student password: ' RHCSA_GUEST_PASSWORD && export RHCSA_GUEST_PASSWORD && echo
bash scripts/provision.sh
```

Then verify the things that matter, in order. **Check 0 first** — if it fails, nothing else is worth measuring:

```bash
VMRUN='/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe'
VMX=$(grep '^RHCSA_VMX=' .env.local | cut -d= -f2-)
IP=$(grep '^RHCSA_VM_IP=' .env.local | cut -d= -f2-)

# 0. Passwordless sudo is in effect. This must print exactly 0.
ssh student@"$IP" -o BatchMode=yes sudo -n id -u

# 1. A revert round-trip is fast and lands on a working machine.
time "$VMRUN" revertToSnapshot "$VMX" clean
time "$VMRUN" start "$VMX" nogui
ssh -i ~/.ssh/rhcsa_lab -o UserKnownHostsFile=~/.ssh/rhcsa_known_hosts \
    student@"$(grep '^RHCSA_VM_IP=' .env.local | cut -d= -f2-)" \
    'uptime; getenforce; findmnt -no SOURCE /var; sudo vgs -o vg_free --noheadings'

# 2. dnf works offline.
ssh -i ~/.ssh/rhcsa_lab student@... 'sudo dnf -y install tree && which tree'

# 3. The layout the Phase 1 lab needs still holds after the revert.
ssh -i ~/.ssh/rhcsa_lab student@... 'df -h /home /var; sudo lvs'
```

Expected: check 0 prints `0`; the revert completes in roughly 5 seconds; `Enforcing`; `/dev/mapper/rhel-var`; non-zero `vg_free`; `tree` installs with no network; `/home` at 8 G and `/var` at 2 G.

**If check 0 prints anything other than `0`, stop.** The sudoers drop-in is missing or malformed, and no grader in the bank will work until it is fixed — every guest-side script calls `sudo` on a connection with no TTY, so a prompt there does not fail cleanly, it silently eats the rest of the script. Re-run `guest-provision.sh` from the VM console and watch its `passwordless sudo installed and verified` line.

**If the revert takes 30 s or more, the snapshot was captured powered-off.** Power the VM on, wait for it to settle, and re-run the snapshot step — this is worth fixing, because it is the difference between 15 and 40 attempted tasks in an evening.

- [ ] **Step 6: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add scripts/provision.sh scripts/guest-provision.sh && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(vm): provision the lab VM and capture the clean snapshot

The DVD image is copied into the guest's own disk rather than host-mounted, so
dnf cannot break when the CD-ROM device is detached. clean is captured live so
reverts take ~5s. No spare disks in Phase 1: a spare disk baked into clean
carries stale partition tables into every reset. restorecon on ~/.ssh is not
optional - a mislabelled authorized_keys makes sshd refuse the key silently."
```

---

### Task 20: `content/lib/assert.sh` — the grader helper library

Every grader sources this. It is the contract between bash and the JSONL parser from Task 5.

**Files:**
- Create: `content/lib/assert.sh`
- Test: `test/lib/assert.test.ts` (shells out to real bash — the only honest way to test bash)

**Interfaces:**
- Consumes: nothing.
- Produces the emitters and helpers graders use:
  - `ck_pass ID DESC`, `ck_fail ID DESC DETAIL`, `ck_skip ID DESC DETAIL`
  - `ck ID DESC CONDITION_EXIT DETAIL` — emit pass or fail from an exit status
  - `to_bytes SIZE` — `2G`, `2048M`, `2GiB`, `1.5G` → bytes
  - `lv_size_bytes VG LV`, `mount_source PATH`, `fs_size_bytes PATH`
  - `within_pct ACTUAL EXPECTED PCT` — tolerance, because filesystems round
  - `is_persistent PATH` — fstab **or** a systemd mount unit
  - Each emitted line is one JSON object, exactly what `parseVerdict` consumes.

**Scope note.** Ten helpers, not thirty. Only what the five Phase 1 tasks need. Adding a helper no grader calls means shipping untested code into the one component whose correctness the whole app rests on.

**Design notes.**
- `to_bytes` uses `awk`, not bash arithmetic, because `1.5G` is a real thing a student will type into `lvextend` and bash cannot multiply floats.
- `within_pct` exists because a 2 GiB XFS filesystem never reports exactly 2 GiB — `df` shows usable space after metadata. An exact comparison would fail a correct answer, which is the worst failure mode a grader has.
- `is_persistent` accepts fstab **or** a systemd `.mount` unit, per spec §6.5 rule 1: grade the end state, not the mechanism.

- [ ] **Step 1: Write the failing test**

`test/lib/assert.test.ts`:

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { parseVerdict } from '../../src/engine/grading/verdict.ts'

const run = promisify(execFile)
const LIB = new URL('../../content/lib/assert.sh', import.meta.url).pathname

/** Run a snippet with assert.sh sourced, and return its stdout. */
async function sh(snippet: string): Promise<string> {
  const { stdout } = await run('bash', ['-c', `set -uo pipefail; . '${LIB}'; ${snippet}`])
  return stdout
}

describe('checkpoint emitters', () => {
  it('emits one JSON object per line that parseVerdict accepts', async () => {
    const out = await sh(`ck_pass lv-var-size "/var LV is 4 GiB"`)
    const v = parseVerdict(out)

    expect(v.noise).toEqual([])
    expect(v.checkpoints).toEqual([
      { id: 'lv-var-size', desc: '/var LV is 4 GiB', status: 'pass' },
    ])
  })

  it('carries detail on failures, since detail is what teaches', async () => {
    const v = parseVerdict(await sh(`ck_fail fs-var-size "/var fs is 4 GiB" "still 2.0G"`))
    expect(v.checkpoints[0]).toEqual({
      id: 'fs-var-size',
      desc: '/var fs is 4 GiB',
      status: 'fail',
      detail: 'still 2.0G',
    })
  })

  it('emits skip with a reason', async () => {
    const v = parseVerdict(await sh(`ck_skip containers "podman task" "not installed"`))
    expect(v.checkpoints[0]?.status).toBe('skip')
    expect(v.checkpoints[0]?.detail).toBe('not installed')
  })

  it('escapes quotes, backslashes, tabs and newlines so one bad path cannot corrupt the verdict', async () => {
    const v = parseVerdict(
      await sh(`ck_fail weird 'says "hi"' 'back\\slash and	tab'`),
    )
    expect(v.noise).toEqual([])
    expect(v.checkpoints[0]?.desc).toBe('says "hi"')
    expect(v.checkpoints[0]?.detail).toContain('back\\slash')
    expect(v.checkpoints[0]?.detail).toContain('\t')
  })

  it('ck turns an exit status into pass or fail', async () => {
    const pass = parseVerdict(await sh(`true; ck a "cond" $? "detail"`))
    expect(pass.checkpoints[0]?.status).toBe('pass')

    const fail = parseVerdict(await sh(`false; ck a "cond" $? "why it failed"`))
    expect(fail.checkpoints[0]?.status).toBe('fail')
    expect(fail.checkpoints[0]?.detail).toBe('why it failed')
  })

  it('emits nothing on stdout other than checkpoint lines', async () => {
    // Graders are parsed, not read. A stray echo becomes noise.
    const out = await sh(`ck_pass a "x"; ck_pass b "y"`)
    expect(out.trimEnd().split('\n')).toHaveLength(2)
  })
})

describe('to_bytes', () => {
  const cases: Array<[string, number]> = [
    ['512', 512],
    ['1K', 1024],
    ['1KiB', 1024],
    ['2M', 2 * 1024 ** 2],
    ['2G', 2 * 1024 ** 3],
    ['2GiB', 2 * 1024 ** 3],
    ['4.00g', 4 * 1024 ** 3],
    ['1.5G', 1.5 * 1024 ** 3],
    ['1T', 1024 ** 4],
    // lvs and df print a trailing unit letter in lower case; both must work.
    ['2g', 2 * 1024 ** 3],
    ['2048m', 2 * 1024 ** 3],
  ]

  for (const [input, expected] of cases) {
    it(`converts ${input}`, async () => {
      expect(Number(await sh(`to_bytes '${input}'`))).toBe(expected)
    })
  }

  it('exits non-zero on unparseable input rather than printing a wrong number', async () => {
    // Returning 0 here would silently pass a size check.
    await expect(sh(`to_bytes 'banana'`)).rejects.toThrow()
  })
})

describe('within_pct', () => {
  it('accepts a filesystem that is slightly smaller than its LV', async () => {
    // A 4 GiB XFS reports ~3.99 GiB usable. Exact equality fails correct work.
    const lv = 4 * 1024 ** 3
    const fs = Math.floor(lv * 0.995)
    const v = parseVerdict(await sh(`within_pct ${fs} ${lv} 2; ck a "size" $? "off by too much"`))
    expect(v.checkpoints[0]?.status).toBe('pass')
  })

  it('rejects a filesystem that was never grown', async () => {
    const v = parseVerdict(
      await sh(`within_pct ${2 * 1024 ** 3} ${4 * 1024 ** 3} 2; ck a "size" $? "not grown"`),
    )
    expect(v.checkpoints[0]?.status).toBe('fail')
  })

  it('is symmetric, so an over-shoot also fails', async () => {
    const v = parseVerdict(
      await sh(`within_pct ${8 * 1024 ** 3} ${4 * 1024 ** 3} 2; ck a "size" $? "too big"`),
    )
    expect(v.checkpoints[0]?.status).toBe('fail')
  })
})

describe('is_persistent', () => {
  it('accepts an fstab entry', async () => {
    const v = parseVerdict(
      await sh(`
        FSTAB=$(mktemp); UNITDIR=$(mktemp -d)
        echo '/dev/mapper/rhel-var /var xfs defaults 0 0' > "$FSTAB"
        is_persistent /var "$FSTAB" "$UNITDIR"; ck p "persistent" $? "not persistent"
      `),
    )
    expect(v.checkpoints[0]?.status).toBe('pass')
  })

  it('accepts a systemd mount unit, because the mechanism is not what is graded', async () => {
    const v = parseVerdict(
      await sh(`
        FSTAB=$(mktemp); UNITDIR=$(mktemp -d)
        printf 'Where=/var\\n' > "$UNITDIR/var.mount"
        is_persistent /var "$FSTAB" "$UNITDIR"; ck p "persistent" $? "not persistent"
      `),
    )
    expect(v.checkpoints[0]?.status).toBe('pass')
  })

  it('rejects neither', async () => {
    const v = parseVerdict(
      await sh(`
        FSTAB=$(mktemp); UNITDIR=$(mktemp -d)
        is_persistent /var "$FSTAB" "$UNITDIR"; ck p "persistent" $? "no fstab, no unit"
      `),
    )
    expect(v.checkpoints[0]?.status).toBe('fail')
  })

  it('does not match a commented-out fstab line', async () => {
    const v = parseVerdict(
      await sh(`
        FSTAB=$(mktemp); UNITDIR=$(mktemp -d)
        echo '#/dev/mapper/rhel-var /var xfs defaults 0 0' > "$FSTAB"
        is_persistent /var "$FSTAB" "$UNITDIR"; ck p "persistent" $? "commented out"
      `),
    )
    expect(v.checkpoints[0]?.status).toBe('fail')
  })

  it('does not match /var when only /var/log is configured', async () => {
    // A prefix match here would pass a wrong answer.
    const v = parseVerdict(
      await sh(`
        FSTAB=$(mktemp); UNITDIR=$(mktemp -d)
        echo '/dev/mapper/rhel-varlog /var/log xfs defaults 0 0' > "$FSTAB"
        is_persistent /var "$FSTAB" "$UNITDIR"; ck p "persistent" $? "wrong mount point"
      `),
    )
    expect(v.checkpoints[0]?.status).toBe('fail')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/lib/assert.test.ts`
Expected: FAIL — bash cannot source `content/lib/assert.sh`.

- [ ] **Step 3: Write `content/lib/assert.sh`**

```bash
# Grader helper library. Sourced by every grade.sh.
#
# Contract with src/engine/grading/verdict.ts:
#   - one JSON object per line on stdout, nothing else
#   - the grader's own exit code is ignored
#   - graders are READ-ONLY: they never change the system they measure
#
# shellcheck shell=bash

# ------------------------------------------------------------------ output

# Escape a value for embedding in a JSON string.
_json_escape() {
  local s=$1
  s=${s//\\/\\\\}      # backslash first, or it doubles the others
  s=${s//\"/\\\"}
  s=${s//$'\t'/\\t}
  s=${s//$'\r'/\\r}
  s=${s//$'\n'/\\n}
  printf '%s' "$s"
}

_emit() {
  local status=$1 id=$2 desc=$3 detail=${4-}
  if [[ -n $detail ]]; then
    printf '{"id":"%s","desc":"%s","status":"%s","detail":"%s"}\n' \
      "$(_json_escape "$id")" "$(_json_escape "$desc")" "$status" "$(_json_escape "$detail")"
  else
    printf '{"id":"%s","desc":"%s","status":"%s"}\n' \
      "$(_json_escape "$id")" "$(_json_escape "$desc")" "$status"
  fi
}

ck_pass() { _emit pass "$1" "$2" "${3-}"; }
ck_fail() { _emit fail "$1" "$2" "${3-}"; }

# skip = could not be evaluated. NOT a pass: allPassed() treats it as not-passed.
ck_skip() { _emit skip "$1" "$2" "${3-}"; }

# ck ID DESC EXIT_STATUS [DETAIL]
# Usage:  some_condition; ck my-id "what was checked" $? "what to look at"
ck() {
  local id=$1 desc=$2 status=$3 detail=${4-}
  if [[ $status -eq 0 ]]; then
    ck_pass "$id" "$desc"
  else
    ck_fail "$id" "$desc" "$detail"
  fi
}

# ------------------------------------------------------------------- sizes

# to_bytes SIZE -> bytes on stdout, exit 1 if unparseable.
#
# Handles what lvs, df and a student's own typing produce: 2G, 2g, 2GiB,
# 2048M, 4.00g, 1.5G, bare bytes. awk does the arithmetic because bash cannot
# multiply 1.5.
to_bytes() {
  local raw=$1
  local num unit
  if [[ ! $raw =~ ^([0-9]+(\.[0-9]+)?)[[:space:]]*([KkMmGgTt]?)(i?[Bb])?$ ]]; then
    printf 'to_bytes: cannot parse %s\n' "$raw" >&2
    return 1
  fi
  num=${BASH_REMATCH[1]}
  unit=${BASH_REMATCH[3]}
  local mult=1
  case ${unit,,} in
    k) mult=1024 ;;
    m) mult=$((1024 ** 2)) ;;
    g) mult=$((1024 ** 3)) ;;
    t) mult=$((1024 ** 4)) ;;
    '') mult=1 ;;
  esac
  awk -v n="$num" -v m="$mult" 'BEGIN { printf "%d\n", n * m }'
}

# within_pct ACTUAL EXPECTED PCT -> exit 0 if |actual-expected| <= pct% of expected.
#
# Filesystems never report their exact device size: XFS metadata makes a 4 GiB
# LV report slightly less usable space. Exact comparison fails correct answers.
within_pct() {
  local actual=$1 expected=$2 pct=$3
  awk -v a="$actual" -v e="$expected" -v p="$pct" 'BEGIN {
    if (e == 0) exit 1
    d = a - e; if (d < 0) d = -d
    exit (d <= e * p / 100) ? 0 : 1
  }'
}

# ------------------------------------------------------------- system state

# lv_size_bytes VG LV -> size in bytes. Empty output + exit 1 if absent.
lv_size_bytes() {
  local vg=$1 lv=$2 out
  out=$(sudo lvs --noheadings --nosuffix --units b -o lv_size "$vg/$lv" 2>/dev/null | tr -d ' ') || return 1
  [[ -n $out ]] || return 1
  printf '%s\n' "$out"
}

# mount_source PATH -> the device currently backing PATH, exit 1 if not a mount point.
mount_source() {
  findmnt -no SOURCE --target "$1" 2>/dev/null || return 1
}

# fs_size_bytes PATH -> the filesystem's total size in bytes.
#
# df, not lvs: this is the number that reveals a forgotten xfs_growfs.
fs_size_bytes() {
  local out
  out=$(df -B1 --output=size "$1" 2>/dev/null | tail -n1 | tr -d ' ') || return 1
  [[ -n $out ]] || return 1
  printf '%s\n' "$out"
}

# is_persistent MOUNTPOINT [FSTAB] [UNITDIR] -> exit 0 if it will mount at boot.
#
# Accepts an fstab entry OR a systemd .mount unit. Per spec 6.5 rule 1 the end
# state is graded, not the mechanism, so a student who chose a mount unit is
# not penalised for it.
is_persistent() {
  local target=$1
  local fstab=${2:-/etc/fstab}
  local unitdir=${3:-/etc/systemd/system}

  # Field 2 must equal the target exactly. A prefix match would accept
  # /var/log as evidence for /var.
  if [[ -r $fstab ]] && awk -v t="$target" '
        /^[[:space:]]*#/ { next }
        NF >= 2 && $2 == t { found = 1 }
        END { exit found ? 0 : 1 }' "$fstab"; then
    return 0
  fi

  if [[ -d $unitdir ]]; then
    local unit
    for unit in "$unitdir"/*.mount; do
      [[ -r $unit ]] || continue
      if grep -qE "^[[:space:]]*Where[[:space:]]*=[[:space:]]*${target}[[:space:]]*$" "$unit"; then
        return 0
      fi
    done
  fi

  return 1
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/lib/assert.test.ts`
Expected: all 26 tests PASS. `to_bytes`, `within_pct`, `is_persistent` and the escaping tests need no VM — they run against real bash on the WSL host.

`lv_size_bytes` and `mount_source` are not unit-tested here: they need `sudo lvs` and a real mount. They are covered by Task 21's fixture matrix, which runs against the VM.

- [ ] **Step 5: Verify the round trip by hand**

The claim worth checking directly is that bash's output and the TypeScript parser agree:

```bash
cd /home/daxtangco/rhcsa-trainer
bash -c '. content/lib/assert.sh
  ck_pass a "all good"
  ck_fail b "size wrong" "found 2.0G, wanted 4.0G"
  ck_skip c "podman" "not installed"' | tee /tmp/v.jsonl

node --input-type=module -e "
import { readFileSync } from 'node:fs'
import { allPassed, parseVerdict } from './src/engine/grading/verdict.ts'
const v = parseVerdict(readFileSync('/tmp/v.jsonl', 'utf8'))
console.log(JSON.stringify(v, null, 2))
console.log('allPassed:', allPassed(v))
"
```
Expected: three checkpoints, `noise: []`, `allPassed: false`.

- [ ] **Step 6: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add content/lib/assert.sh test/lib && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(content): grader helper library

Ten helpers, only what the Phase 1 tasks need. Tested by shelling out to
real bash, so the JSONL that bash emits is checked against the parser that
consumes it rather than against an assumption. within_pct exists because an
exact size comparison fails a correct answer: XFS metadata means a 4 GiB LV
never reports 4 GiB usable. is_persistent accepts fstab or a systemd mount
unit, since the end state is graded and not the mechanism."
```

---

## Part 3 — The first real content and the thin UI (Tasks 21–25)

---

### Task 21: Author the first task, end to end

The Phase 1 exit criterion runs through this directory. Everything before it was scaffolding for this.

**Files:**
- Create: `content/tasks/storage/014-grow-home-lv/task.yaml`
- Create: `content/tasks/storage/014-grow-home-lv/setup.sh`
- Create: `content/tasks/storage/014-grow-home-lv/grade.sh`
- Create: `content/tasks/storage/014-grow-home-lv/solutions/01-lvextend-then-growfs.sh`
- Create: `content/tasks/storage/014-grow-home-lv/solutions/02-lvextend-r-by-uuid.sh`
- Create: `content/tasks/storage/014-grow-home-lv/antisolutions/01-forgot-growfs.sh`
- Create: `content/tasks/storage/014-grow-home-lv/antisolutions/02-removed-persistence.sh`
- Create: `content/tasks/storage/014-grow-home-lv/antisolutions/03-wrong-lv.sh`
- Create: `content/concepts/storage/lvm-abstraction-stack.md`
- Create: `content/concepts/storage/why-xfs-cannot-shrink.md`
- Create: `src/engine/validate/run.ts` (`validateBank` over many tasks)
- Modify: `src/cli/index.ts` (add the `validate` command deferred from Task 12)
- Test: `test/validate/run.test.ts`

**Interfaces:**
- Consumes: everything. `loadBank` (T7), `loadTaskScripts`/`validateTask` (T11), `chooseTransport` (T18), `VmController` (T17), `assert.sh` (T20), the objective ids from T13.
- Produces: the content conventions Task 22 copies, and `rhcsa validate [taskId]`.

**Two decisions worth stating before the code.**

**1. The task grows `/home`, not `/var`.** An anti-solution has to remove the mount's persistence to prove the reboot check works. Doing that to `/var` risks a machine that does not come back — RHEL 9 boots with an empty `/var` only sometimes, and when it does not, the harness reports `reboot failed` instead of the checkpoint failure it was testing. The harness cannot tell "correctly broken" from "unbootable", so the anti-solution would fail for the wrong reason. `/home` carries the same `storage.lvm.resize` objective, the same two-step grow, and the same persistence signature, and a machine with no `/home` boots every time.

**2. `fs-home-size` checks the size **and** the source device.** Either check alone has a hole. "Filesystem fills its LV" passes on an untouched system, so it cannot be a goal checkpoint. "Filesystem at `/home` is ≥ 12 GiB" passes after the mount disappears, because `/home` then falls back to the 12 GiB root filesystem. Requiring both closes it, and makes every fixture's outcome independent of what size the root LV happens to be.

- [ ] **Step 1: Write `task.yaml`**

`content/tasks/storage/014-grow-home-lv/task.yaml`:

```yaml
id: storage/014-grow-home-lv
title: Grow /home to 12 GiB
chapter: 15
scope: exam-objective
rhel: 9
objectives:
  - storage.lvm.resize
requires_concepts:
  - storage.lvm-abstraction-stack
  - storage.why-xfs-cannot-shrink
difficulty: 3
time_budget: 600
# Present in both editions' chapter 15, so it is durable core material
# (spec section 14.4).
weight: high
editions: [r9, r10]
reboot_check: true
requires_disks: 0
transport: ssh
prompt: |
  Users are reporting that /home is almost full.

  Make at least 12 GiB of space available under /home, using the free space
  already present in the volume group. Do not remove any existing data, and do
  not take space away from any other filesystem.

  Your change must still be in effect after a reboot.
```

- [ ] **Step 2: Write `setup.sh`**

Setup verifies the machine it was promised and then creates the pressure the prompt describes. It exits non-zero if the layout is wrong, which the harness reports rather than grading a machine that cannot be solved.

`content/tasks/storage/014-grow-home-lv/setup.sh`:

```bash
#!/usr/bin/env bash
# Prepare the system for storage/014-grow-home-lv.
#
# Idempotent: reset reverts to the `clean` snapshot, but setup must also
# survive being run twice against the same machine.
set -euo pipefail

fail() { printf 'setup: %s\n' "$*" >&2; exit 1; }

# --- preconditions ---------------------------------------------------------
# These are guarantees from docs/vm-build-checklist.md. If any is missing the
# task is unsolvable, and a checkpoint failure would be misleading.
src=$(findmnt -no SOURCE --target /home 2>/dev/null || true)
case $src in
  /dev/mapper/rhel-home | /dev/rhel/home) ;;
  *) fail "/home must be its own LV (found: ${src:-nothing}); see docs/vm-build-checklist.md" ;;
esac

free_extents=$(sudo vgs --noheadings --nosuffix --units b -o vg_free rhel 2>/dev/null | tr -d ' ')
[[ -n $free_extents ]] || fail "volume group 'rhel' not found"
if (( free_extents < 5 * 1024 * 1024 * 1024 )); then
  fail "VG rhel has only ${free_extents} bytes free; this task needs at least 5 GiB"
fi

# --- create the pressure the prompt describes -----------------------------
# A believable "/home is almost full" beats an instruction to resize something
# for no reason. fallocate is instant on XFS.
FILLER=/home/.rhcsa-filler.dat
if [[ ! -f $FILLER ]]; then
  sudo fallocate -l 6500M "$FILLER"
  sudo chmod 600 "$FILLER"
fi

# The grader never reads history, but a student who reverts and sees their own
# previous commands has been given a hint nobody offered them.
: > "$HOME/.bash_history" 2>/dev/null || true

exit 0
```

- [ ] **Step 3: Write `grade.sh`**

`content/tasks/storage/014-grow-home-lv/grade.sh`:

```bash
#!/usr/bin/env bash
# Grader for storage/014-grow-home-lv.
#
# READ-ONLY. Changes nothing. Exit code is ignored; only the JSONL matters.
# assert.sh is prepended by loadTaskScripts, so its helpers are already here.
#
# Checkpoints that must fail before the student does anything. Everything not
# listed is an invariant and must PASS from the start.
# baseline-fail: lv-home-size, fs-home-size

TARGET=$(to_bytes 12G)
HOME_LV_MIN=$TARGET
VAR_MIN=$(to_bytes 2G)

# --- 1. the logical volume grew -------------------------------------------
lv_bytes=$(lv_size_bytes rhel home || echo 0)
if [[ ${lv_bytes:-0} -ge $HOME_LV_MIN ]]; then
  ck_pass lv-home-size "logical volume rhel/home is at least 12 GiB"
else
  ck_fail lv-home-size "logical volume rhel/home is at least 12 GiB" \
    "rhel/home is ${lv_bytes:-0} bytes; lvextend grows the volume"
fi

# --- 2. the filesystem grew too, and it is still the LV's filesystem ------
# Both halves are needed. "fills its LV" passes on an untouched system, and
# "is 12 GiB" passes once /home falls back to the 12 GiB root filesystem.
home_src=$(mount_source /home 2>/dev/null || true)
home_on_lv=no
case $home_src in
  /dev/mapper/rhel-home | /dev/rhel/home) home_on_lv=yes ;;
esac

fs_bytes=$(fs_size_bytes /home 2>/dev/null || echo 0)

if [[ $home_on_lv == no ]]; then
  ck_fail fs-home-size "the filesystem on /home is at least 12 GiB" \
    "/home is not mounted from rhel/home (source: ${home_src:-none})"
# within_pct first, exact second. A 12 GiB XFS filesystem never reports 12 GiB
# usable — df shows space after metadata — so a bare `-ge $TARGET` fails both
# correct solutions and makes `6/6 fixtures ok` unreachable. This is exactly
# what within_pct exists for.
elif within_pct "${fs_bytes:-0}" "$TARGET" 2 || [[ ${fs_bytes:-0} -ge $TARGET ]]; then
  ck_pass fs-home-size "the filesystem on /home is at least 12 GiB"
else
  ck_fail fs-home-size "the filesystem on /home is at least 12 GiB" \
    "df reports ${fs_bytes:-0} bytes; growing the LV does not grow the filesystem inside it"
fi

# --- 3. /home is still served by its own logical volume -------------------
if [[ $home_on_lv == yes ]]; then
  ck_pass home-from-lv "/home is mounted from the rhel/home logical volume"
else
  ck_fail home-from-lv "/home is mounted from the rhel/home logical volume" \
    "findmnt reports ${home_src:-nothing} for /home"
fi

# --- 4. nothing was taken from /var --------------------------------------
# An invariant: it passes from the start, and exists to catch a destructive
# answer that funds /home by damaging something else.
var_src=$(mount_source /var 2>/dev/null || true)
var_lv=$(lv_size_bytes rhel var || echo 0)
case $var_src in
  /dev/mapper/rhel-var | /dev/rhel/var)
    if [[ ${var_lv:-0} -ge $VAR_MIN ]]; then
      ck_pass var-intact "/var is untouched: still its own LV, still at least 2 GiB"
    else
      ck_fail var-intact "/var is untouched: still its own LV, still at least 2 GiB" \
        "rhel/var is now ${var_lv:-0} bytes"
    fi
    ;;
  *)
    ck_fail var-intact "/var is untouched: still its own LV, still at least 2 GiB" \
      "/var is mounted from ${var_src:-nothing}"
    ;;
esac

# --- 5. it survives a reboot ---------------------------------------------
# Mechanism-agnostic on purpose (spec 6.5 rule 1): fstab and a systemd mount
# unit are both correct answers, and a UUID is as good as a device path.
if is_persistent /home; then
  ck_pass persist-config "/home is configured to mount at boot"
else
  ck_fail persist-config "/home is configured to mount at boot" \
    "no /home entry in /etc/fstab and no matching .mount unit"
fi
```

- [ ] **Step 4: Write the two solutions**

Two *independent* correct paths, not two spellings of one. The second differs in both mechanism (`lvextend -r` instead of a separate `xfs_growfs`) and persistence expression (UUID instead of the device-mapper path). If a grader over-fits to one command or one fstab string, solution 02 is what catches it.

`solutions/01-lvextend-then-growfs.sh`:

```bash
#!/usr/bin/env bash
# The two-step path: grow the volume, then grow the filesystem inside it.
set -euo pipefail
sudo lvextend -L 12G /dev/rhel/home
sudo xfs_growfs /home
```

`solutions/02-lvextend-r-by-uuid.sh`:

```bash
#!/usr/bin/env bash
# Equally correct, and deliberately different in two ways:
#   -r resizes the filesystem as part of lvextend, so no xfs_growfs runs
#   the fstab entry is re-expressed by UUID, so a grader that greps for
#   /dev/mapper/rhel-home would wrongly reject this
set -euo pipefail
sudo lvextend -r -L +4G /dev/mapper/rhel-home

uuid=$(sudo blkid -s UUID -o value /dev/mapper/rhel-home)
# The pattern requires whitespace on both sides of /home, so it cannot match
# a /home/something entry.
sudo sed -i '\|[[:space:]]/home[[:space:]]|d' /etc/fstab
printf 'UUID=%s /home xfs defaults 0 0\n' "$uuid" | sudo tee -a /etc/fstab >/dev/null
sudo systemctl daemon-reload
```

- [ ] **Step 5: Write the three anti-solutions**

Each declares exactly which checkpoints it must break. If the grader fails more or fewer than declared, `validate` fails — that is what makes these false-positive detectors rather than decoration.

`antisolutions/01-forgot-growfs.sh`:

```bash
#!/usr/bin/env bash
# The single most common real mistake: the volume grew, the filesystem did not.
# df still shows 8 GiB. Wrong in both verdicts.
# expect-fail: fs-home-size
set -euo pipefail
sudo lvextend -L 12G /dev/rhel/home
```

`antisolutions/02-removed-persistence.sh`:

```bash
#!/usr/bin/env bash
# Correct right now, gone after a reboot. This is the persistence signature the
# whole reboot check exists to detect.
#
# persist-config is wrong immediately. home-from-lv and fs-home-size only break
# after the reboot, because until then /home is still mounted - which is exactly
# why one phase per file would not be enough to express this.
# expect-fail: persist-config, home-from-lv@post, fs-home-size@post
set -euo pipefail
sudo lvextend -L 12G /dev/rhel/home
sudo xfs_growfs /home
sudo sed -i '\|[[:space:]]/home[[:space:]]|s|^|#|' /etc/fstab
sudo systemctl daemon-reload
```

`antisolutions/03-wrong-lv.sh`:

```bash
#!/usr/bin/env bash
# Grew the wrong logical volume: root got the space, /home did not. Proves the
# grader looks at rhel/home specifically rather than at "did the VG shrink".
# expect-fail: lv-home-size, fs-home-size
set -euo pipefail
sudo lvextend -r -L +4G /dev/rhel/root
```

- [ ] **Step 6: Write the two concept cards**

These are the reason the app can replace the book. The card is what the user reads at rung 3 of the disclosure ladder — it must actually teach, not gesture at a man page.

`content/concepts/storage/lvm-abstraction-stack.md`:

Six backticks on this block, not three: the card itself contains a fenced code block, and a three-backtick outer fence would end at the inner one instead of at the end of the card.

``````markdown
---
id: storage.lvm-abstraction-stack
title: Physical volumes, volume groups, logical volumes
rhel: 9
objectives: [storage.lvm.resize]
sources: [r9:ch15, r10:ch15]
---
LVM puts two layers between a disk and a filesystem, and almost every LVM
mistake comes from forgetting one of them.

A **physical volume** is a whole disk or a partition that has been handed over
to LVM with `pvcreate`. A **volume group** pools one or more physical volumes
into a single space to allocate from — `vgcreate`, `vgextend`. A **logical
volume** is a slice carved out of that pool with `lvcreate`, and it is the only
one of the three you ever format and mount.

Read the stack from the bottom up and the commands stop needing memorisation:

```
filesystem   xfs, ext4          mkfs, xfs_growfs
logical vol  /dev/rhel/home     lvcreate, lvextend, lvs
volume group rhel               vgcreate, vgextend, vgs
physical vol /dev/sdb1          pvcreate, pvs
disk         /dev/sdb           lsblk
```

The consequence that catches people: **a filesystem does not notice that its
logical volume grew.** `lvextend` changes the size of the container; the
filesystem inside it keeps using the size it was created with, so `lvs` shows
12 GiB while `df` still shows 8 GiB. You either grow the filesystem afterwards
(`xfs_growfs /home`) or tell `lvextend` to do it for you (`lvextend -r`).

The other consequence is the useful one: because a logical volume is allocated
from a pool, it does not have to be contiguous and does not have to live on one
disk. That is why growing a volume almost never requires touching a partition
table, and why leaving free space *in the volume group* rather than in a
partition is what makes a system easy to extend later.

Three commands are worth reaching for before anything else: `lsblk` to see the
shape of the storage, `lvs` to see what LVM thinks the sizes are, and `df -h`
to see what the filesystems think. When `lvs` and `df` disagree, you already
know what went wrong.
``````

`content/concepts/storage/why-xfs-cannot-shrink.md`:

```markdown
---
id: storage.why-xfs-cannot-shrink
title: XFS grows but never shrinks
rhel: 9
objectives: [storage.lvm.resize]
sources: [r9:ch15, r10:ch15]
prerequisites: [storage.lvm-abstraction-stack]
---
XFS has no shrink operation. Not "it is risky", not "it needs a flag" — the
tooling does not exist. `xfs_growfs` grows a mounted filesystem; there is no
`xfs_shrinkfs`, and there never has been. XFS is the default filesystem on
RHEL, so on a stock system this is the case you are in.

The reason is that XFS spreads metadata across allocation groups over the whole
device as it is used. Shrinking would mean relocating metadata that the format
was never designed to relocate. Growing only adds allocation groups, which is
straightforward, so that is the only direction supported.

What this means in practice:

- `lvreduce` on a volume holding XFS **destroys data**. The volume shrinks; the
  filesystem does not know and keeps addressing blocks that are no longer
  there. `lvreduce` warns you. Believe it.
- To genuinely reclaim space from an XFS filesystem you back up the data,
  `lvremove` the volume, create a smaller one, `mkfs.xfs` it, and restore. That
  is a maintenance window, not a command.
- ext4 *can* shrink, but only while unmounted: `umount`, then
  `resize2fs /dev/vg/lv 4G`, then `lvreduce`. Filesystem first when shrinking,
  volume first when growing — the order is opposite in the two directions,
  and getting it backwards is how people lose data.

This is why sizing decisions matter more on RHEL than they might elsewhere, and
why the habit worth building is to **leave free extents in the volume group
rather than handing every extent to a filesystem on day one.** Space still in
the volume group can go anywhere. Space inside an XFS filesystem is committed
for good.

So when a task asks you to make room, the question is never "what can I
shrink" — it is "what free space does `vgs` show, and if the answer is none,
what disk can I add".
```

- [ ] **Step 7: Extract the validation loop, with a test**

Add `src/engine/validate/run.ts`, which is the part of `rhcsa validate` worth testing without a VM:

```ts
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
```

`test/validate/run.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { validateBank } from '../../src/engine/validate/run.ts'
import type { TaskScripts } from '../../src/engine/validate/harness.ts'
import { FakeTransport } from '../../src/engine/vm/fake.ts'
import type { TaskSpec } from '../../src/engine/content/task.ts'

function task(id: string): TaskSpec {
  return {
    id,
    title: id,
    chapter: 15,
    scope: 'exam-objective',
    rhel: 9,
    objectives: ['storage.lvm.resize'],
    requiresConcepts: [],
    difficulty: 3,
    timeBudget: 600,
    weight: 'high',
    editions: ['r9'],
    rebootCheck: false,
    requiresDisks: 0,
    claims: [],
    transport: 'ssh',
    prompt: 'p',
    dir: `/content/${id}`,
  }
}

const PASSING: TaskScripts = {
  setup: 'SETUP',
  grade: '# baseline-fail: goal\nGRADE',
  fixtures: [
    { kind: 'none', name: 'no-action', script: '' },
    { kind: 'solution', name: '01.sh', script: 'DO' },
    { kind: 'solution', name: '02.sh', script: 'DO' },
    { kind: 'antisolution', name: '01.sh', script: '# expect-fail: goal\n' },
  ],
}

function deps() {
  let done = false
  return {
    transport: new FakeTransport((script) => {
      if (script.includes('SETUP')) done = false
      else if (script.includes('DO')) done = true
      if (script.includes('GRADE')) {
        return {
          stdout: `{"id":"goal","desc":"g","status":"${done ? 'pass' : 'fail'}"}`,
          stderr: '',
          code: 0,
        }
      }
      return { stdout: '', stderr: '', code: 0 }
    }),
    reset: async () => {
      done = false
    },
    reboot: async () => {},
  }
}

describe('validateBank', () => {
  it('runs every fixture of every task and reports nothing failed', async () => {
    const seen: string[] = []
    const summary = await validateBank({
      tasks: [task('storage/014-a'), task('storage/015-b')],
      assertLib: '',
      deps: deps(),
      loadScripts: async () => PASSING,
      onTask: (id) => seen.push(id),
    })

    expect(seen).toEqual(['storage/014-a', 'storage/015-b'])
    expect(summary.results).toHaveLength(8)
    expect(summary.failed, JSON.stringify(summary.failed)).toEqual([])
  })

  it('reports an unloadable task as a failure instead of throwing', async () => {
    // One task with a missing grade.sh must not hide the state of the rest.
    const summary = await validateBank({
      tasks: [task('storage/014-a'), task('storage/015-b')],
      assertLib: '',
      deps: deps(),
      loadScripts: async (t) => {
        if (t.id === 'storage/014-a') throw new Error('ENOENT: grade.sh')
        return PASSING
      },
    })

    expect(summary.failed).toHaveLength(1)
    expect(summary.failed[0]?.name).toBe('load-scripts')
    expect(summary.failed[0]?.failures[0]).toMatch(/ENOENT: grade\.sh/)
    // The second task still ran.
    expect(summary.results.filter((r) => r.taskId === 'storage/015-b')).toHaveLength(4)
  })
})
```

- [ ] **Step 8: Run the run.ts tests**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/validate/run.test.ts`
Expected: FAIL first (module missing), then 2 tests PASS after Step 7's implementation is in place.

- [ ] **Step 9: Add the `validate` command to the CLI**

Add to `src/cli/index.ts`. The command is thin wiring: everything it decides is already unit-tested, and the acceptance step below is what proves the wiring.

```ts
// --- new imports ---
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateBank } from '../engine/validate/run.ts'
import { loadTaskScripts } from '../engine/validate/harness.ts'
import { loadVmConfig } from '../engine/vm/config.ts'
import { chooseTransport } from '../engine/vm/select.ts'
import { VmController } from '../engine/vm/vmrun.ts'
```

```ts
async function validate(argv: string[], io: CliIo): Promise<number> {
  const root = option(argv, 'content', 'content')
  const snapshot = option(argv, 'snapshot', 'clean')
  const wanted = positionals(argv)

  let bank
  try {
    bank = await loadBank(root)
  } catch (e) {
    if (e instanceof ContentError) {
      io.err(e.message)
      return 1
    }
    throw e
  }

  const tasks = wanted.length === 0 ? bank.tasks : []
  for (const id of wanted) {
    const t = bank.tasksById.get(id)
    if (!t) {
      io.err(`unknown task: ${id}`)
      return 1
    }
    tasks.push(t)
  }

  if (tasks.length === 0) {
    io.err(`no tasks found under ${root}/tasks`)
    return 1
  }

  const cfg = loadVmConfig(process.env)
  const controller = new VmController(cfg)
  // A task can require the vmrun transport; honour the strictest requirement
  // across the set rather than probing per task.
  const require = tasks.some((t) => t.transport === 'vmrun') ? 'vmrun' : undefined
  const transport = await chooseTransport(cfg, require ? { require } : {})
  io.out(`transport: ${transport.kind}`)

  const assertLib = await readFile(join(root, 'lib', 'assert.sh'), 'utf8')

  const summary = await validateBank({
    tasks,
    assertLib,
    deps: {
      transport,
      // Every fixture starts from the same known machine. This is the whole
      // reason the clean snapshot is captured live.
      reset: () => controller.revert(snapshot),
      reboot: () => controller.reboot(),
    },
    loadScripts: loadTaskScripts,
    onTask: (id) => io.out(`\n${id}`),
  })

  for (const r of summary.results) {
    io.out(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.kind}/${r.name}`)
    for (const f of r.failures) io.out(`         ${f}`)
  }

  io.out(
    `\n${summary.results.length - summary.failed.length}/${summary.results.length} fixtures ok`,
  )
  return summary.failed.length === 0 ? 0 : 1
}
```

Extend the dispatcher and usage:

```ts
const VALUE_FLAGS = new Set(['content', 'snapshot'])

/** Arguments that are not flags and not a flag's value. */
function positionals(argv: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? ''
    if (a.startsWith('--')) {
      if (VALUE_FLAGS.has(a.slice(2))) i += 1
      continue
    }
    out.push(a)
  }
  return out
}
```

```ts
const USAGE = `usage: rhcsa <command> [options]

commands:
  coverage              report content coverage gaps
  validate [task-id]    run every fixture of every task against the lab VM

options:
  --content <dir>       content root (default: ./content)
  --strict              coverage: exit non-zero while gaps remain
  --snapshot <name>     validate: snapshot to reset to (default: clean)`
```

```ts
    case 'validate':
      return await validate(rest, io)
```

- [ ] **Step 10: Check the content loads and every reference resolves**

Run:
```bash
cd /home/daxtangco/rhcsa-trainer
node src/cli/index.ts coverage; echo "exit=$?"
```

Expected: `tasks: 1`, `concepts: 2`, `untaught concepts: 0`, no `problem:` lines, `exit=0`.

**`untaught concepts: 0` is the assertion that matters** — it proves both cards are reachable through `requires_concepts`. If `problem: ... maps to unknown objective: storage.lvm.resize` appears, Task 13's transcription used a different id for that objective; change `task.yaml` and both cards to the real id rather than adding an id to `objectives.yaml` to suit the task.

- [ ] **Step 11: Check the scripts are valid bash before involving a VM**

Run:
```bash
cd /home/daxtangco/rhcsa-trainer
for f in content/tasks/storage/014-grow-home-lv/setup.sh \
         content/tasks/storage/014-grow-home-lv/grade.sh \
         content/tasks/storage/014-grow-home-lv/solutions/*.sh \
         content/tasks/storage/014-grow-home-lv/antisolutions/*.sh; do
  bash -n "$f" || echo "SYNTAX ERROR: $f"
done
echo "syntax pass complete"
```
Expected: no `SYNTAX ERROR` lines. `grade.sh` alone references helpers it does not define, which `bash -n` does not mind.

Also confirm every declared checkpoint id is one the grader actually emits:

```bash
cd /home/daxtangco/rhcsa-trainer
T=content/tasks/storage/014-grow-home-lv
emitted=$(grep -oE 'ck_(pass|fail|skip) [a-z0-9-]+' "$T/grade.sh" | awk '{print $2}' | sort -u)
declared=$(grep -hoE '^# (expect|baseline)-fail:.*' "$T/grade.sh" "$T"/antisolutions/*.sh \
  | sed 's/^# [a-z]*-fail://' | tr ',' '\n' | sed 's/@.*//' | tr -d ' ' | sort -u)
comm -13 <(echo "$emitted") <(echo "$declared")
echo "^ any id above is declared but never emitted"
```
Expected: no output above the marker line.

- [ ] **Step 12: ACCEPTANCE — run the full fixture matrix against the VM**

This is the step that proves the grader is trustworthy. It runs 6 fixtures × up to 2 verdicts, each preceded by a snapshot revert, so budget 10–15 minutes.

```bash
cd /home/daxtangco/rhcsa-trainer
export RHCSA_GUEST_PASSWORD=...   # only needed if the vmrun transport is selected
node --env-file-if-exists=.env.local src/cli/index.ts validate storage/014-grow-home-lv
echo "exit=$?"
```

`--env-file-if-exists=.env.local` is what supplies `RHCSA_VMX` and `RHCSA_VM_IP`. Without it the command exits immediately with `RHCSA_VMX is not set`. Task 25 wraps this in `npm run validate` so the flag stops being something to remember.

Expected:
```
transport: ssh

storage/014-grow-home-lv
  ok   none/no-action
  ok   solution/01-lvextend-then-growfs.sh
  ok   solution/02-lvextend-r-by-uuid.sh
  ok   antisolution/01-forgot-growfs.sh
  ok   antisolution/02-removed-persistence.sh
  ok   antisolution/03-wrong-lv.sh

6/6 fixtures ok
exit=0
```

How to read a failure — the direction matters more than the count:

| Failure | What it means | Fix |
|---|---|---|
| `no-action`: `lv-home-size: expected fail, got pass` | the grader passes an untouched system | the checkpoint is not measuring what it claims |
| `no-action`: `var-intact: expected pass, got fail` | an invariant is broken at baseline | usually a wrong VM layout — re-read `setup.sh`'s preconditions |
| `solution/02`: any `expected pass, got fail` | **grader over-fitting** — the most valuable finding here | make the checkpoint mechanism-agnostic; do not change the solution to suit the grader |
| `antisolution/02`: `home-from-lv: expected pass, got fail` in verdict **A** | the phase is wrong: it breaks immediately, not only after the reboot | move the id off `@post` |
| `antisolution/*`: `expected fail, got pass` | **false positive** — the grader accepts wrong work | tighten the checkpoint |
| any fixture: `reboot failed: ...` | the guest did not come back | not a content bug; check the transport and `docs/r1-findings.md` |

**Do not proceed to Task 22 until this is `6/6`.** Every later task copies these conventions, so a flaw here is a flaw twenty times over.

- [ ] **Step 13: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add content/tasks content/concepts src/engine/validate/run.ts src/cli/index.ts test/validate/run.test.ts && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(content): first graded task, two concept cards, rhcsa validate

The task grows /home rather than /var: an anti-solution has to remove the
mount's persistence to prove the reboot check, and a machine with no /var may
not come back - which the harness cannot distinguish from the checkpoint
failure it was testing. /home carries the same objective and boots every time.

fs-home-size checks both the size and the source device. Either alone has a
hole: 'fills its LV' passes on an untouched system, and 'is 12 GiB' passes once
/home falls back to the root filesystem.

Solution 02 differs in mechanism and in how persistence is expressed, so it
fails the moment a grader over-fits to one command or one fstab string."
```

---

### Task 22: Four more tasks — users, SELinux, systemd, troubleshooting

**Files:**
- Create: `content/tasks/users/006-team-provisioning/` (`task.yaml`, `setup.sh`, `grade.sh`, 3 solutions, 2 antisolutions — `03-primary-group-only.sh` is a correct answer and therefore a solution, so this directory still contributes 6 fixtures and the `18/18` arithmetic is unchanged)
- Create: `content/tasks/selinux/019-httpd-alt-port/` (same shape)
- Create: `content/tasks/systemd/017-boot-time-service/` (same shape)
- Create: `content/tasks/troubleshooting/028-restore-remote-access/` (same shape)
- Create: `content/concepts/users/shadow-aging-fields.md`
- Create: `content/concepts/users/sudoers-and-wheel.md`
- Create: `content/concepts/selinux/labels-now-vs-policy.md`
- Create: `content/concepts/selinux/ports-are-labeled-too.md`
- Create: `content/concepts/net/firewalld-runtime-vs-permanent.md`
- Create: `content/concepts/systemd/enabled-vs-started.md`
- Create: `content/concepts/systemd/unit-file-anatomy.md`
- Create: `content/concepts/net/nm-connections-are-the-config.md`

**Interfaces:**
- Consumes: every convention established in Task 21 — `assert.sh` helpers, the `# baseline-fail:` and `# expect-fail:` headers, `@post` phases, `rhcsa validate`
- Produces: the five-task bank Task 23's API serves and Task 25's exit criterion draws from

**Why these four.** Together they cover the four *shapes* of RHCSA question, so the conventions get stress-tested before twenty more tasks copy them: pure state (users), multi-subsystem composition (SELinux + firewall + httpd), persistence-is-the-whole-point (systemd), and recovery with the network gone (troubleshooting, which is the only task that forces `transport: vmrun`).

**Objective ids.** Every `objectives:` value below is the id Task 13's transcription is expected to produce. If a transcription used a different id, **change the task's `task.yaml` and its concept cards to match `objectives.yaml`** — do not add an id to `objectives.yaml` to suit a task. `rhcsa coverage` reports any mismatch as `problem: ... maps to unknown objective`.

- [ ] **Step 1: `content/tasks/users/006-team-provisioning/`**

`task.yaml`:

```yaml
id: users/006-team-provisioning
title: Provision the devops team
chapter: 6
scope: exam-objective
rhel: 9
objectives:
  - users.accounts.manage
  - users.groups.manage
  - users.password.aging
  - users.sudo.configure
requires_concepts:
  - users.shadow-aging-fields
  - users.sudoers-and-wheel
difficulty: 2
time_budget: 600
weight: high
editions: [r9, r10]
reboot_check: false
requires_disks: 0
transport: ssh
prompt: |
  Three people are joining the devops team.

  - Create a group named devops with GID 5000.
  - Create users alice and bob. Both must be members of devops in
    addition to their own primary groups.
  - Create a user carol whose account expires on 2027-06-30 and who is a
    member of devops.
  - alice must be forced to change her password at least every 30 days.
  - Every member of devops must be able to run any command with sudo.

  Do not change anything about the student account.
```

**`reboot_check: false` is deliberate.** Everything here lives in `/etc/passwd`, `/etc/shadow`, `/etc/group` and `/etc/sudoers*`, which are files on disk — there is no runtime-only way to create a user. A reboot check would add ninety seconds to each of six fixtures to prove nothing. Reserve the reboot for tasks where a wrong answer can look right, which is why the other three tasks in this batch all set it `true`.

`setup.sh`:

```bash
#!/usr/bin/env bash
# Remove any prior attempt so the task is repeatable, and prove the names are
# free before the student is told to create them.
set -uo pipefail

for u in alice bob carol; do
  if id "$u" &>/dev/null; then
    sudo userdel -r "$u" 2>/dev/null || sudo userdel "$u"
  fi
done
getent group devops &>/dev/null && sudo groupdel devops
sudo rm -f /etc/sudoers.d/devops

# The task says not to touch student; make sure it starts correct so the
# invariant checkpoint means something.
sudo usermod -aG wheel student

cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
```

`grade.sh`:

```bash
#!/usr/bin/env bash
# Graded end state. student-intact passes before any work is done: it is an
# invariant, there to catch an answer that solves the task destructively.
# baseline-fail: group-gid, alice-in-devops, bob-in-devops, carol-in-devops, carol-expiry, alice-maxdays, sudo-devops
set -uo pipefail

gid=$(getent group devops | cut -d: -f3)
[ "$gid" = "5000" ]
ck group-gid "group devops exists with GID 5000" $? "gid=${gid:-none}"

# id -nG lists every group, primary and secondary, whatever mechanism put the
# user there. Written out three times rather than looped, because every ck call
# must have a literal id - see the note below.
in_devops() { id -nG "$1" 2>/dev/null | tr ' ' '\n' | grep -qx devops; }

in_devops alice
ck alice-in-devops "alice is a member of devops" $?
in_devops bob
ck bob-in-devops "bob is a member of devops" $?
in_devops carol
ck carol-in-devops "carol is a member of devops" $?

# Field 8 of /etc/shadow is the expiry date in days since the epoch.
# 2027-06-30 is what the prompt asks for; compare as a date, not as a string,
# so any correct spelling of the date passes.
want=$(date -u -d 2027-06-30 +%s)
days=$(sudo getent shadow carol | cut -d: -f8)
got=$([ -n "$days" ] && echo $((days * 86400)) || echo "")
[ -n "$got" ] && [ "$got" = "$want" ]
ck carol-expiry "carol's account expires 2027-06-30" $? "shadow field 8=${days:-empty}"

max=$(sudo getent shadow alice | cut -d: -f5)
[ "$max" = "30" ]
ck alice-maxdays "alice must change her password every 30 days" $? "maxdays=${max:-empty}"

# sudo -l -U asks the real sudoers parser what alice may run, so it does not
# matter whether the rule is in /etc/sudoers or a file in /etc/sudoers.d.
sudo sudo -l -U alice 2>/dev/null | grep -qE '\(ALL(:ALL)?\)[[:space:]]+(NOPASSWD:[[:space:]]*)?ALL'
ck sudo-devops "members of devops may run any command with sudo" $?

id -nG student | tr ' ' '\n' | grep -qx wheel
ck student-intact "the student account is untouched and still in wheel" $?

exit 0
```

**Every checkpoint id is written as a literal in the grader — never a variable,
never interpolated — so the masked total can be derived without running
anything.** No loops, no `"${var}-suffix"`. That total is what the Lab screen
shows *before* the student has been graded, and Task 23's `countCheckpoints`
derives it by static inspection over `ck`, `ck_pass`, `ck_fail` and `ck_skip`.
Emitting one id from several branches is normal and does not change the total:
the count is of distinct ids, not of call sites, which is exactly what an
`if`/`else` pair reporting the same checkpoint two ways requires. A generated id
is what breaks it, and a wrong count is worse than no count. A helper function
is the right way to avoid the repetition, as above.

`solutions/01-useradd-usermod-chage.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
sudo groupadd -g 5000 devops
sudo useradd alice
sudo useradd bob
sudo useradd carol
sudo usermod -aG devops alice
sudo usermod -aG devops bob
sudo usermod -aG devops carol
sudo chage -E 2027-06-30 carol
sudo chage -M 30 alice
printf '%%devops ALL=(ALL) ALL\n' | sudo tee /etc/sudoers.d/devops >/dev/null
sudo chmod 0440 /etc/sudoers.d/devops
sudo visudo -c
```

`solutions/02-groupmembers-at-creation.sh`:

```bash
#!/usr/bin/env bash
# Independent in three ways: membership is set when the account is created,
# aging is set with passwd instead of chage, and the sudo rule is appended to
# /etc/sudoers instead of dropped into /etc/sudoers.d. All three are correct,
# and each one breaks a grader that greps for a command or a file.
set -euo pipefail
sudo groupadd --gid 5000 devops
sudo useradd -G devops alice
sudo useradd -G devops bob
sudo useradd -G devops -e 2027-06-30 carol
sudo passwd -x 30 alice

# Edit a copy and let visudo validate it before it goes live: a broken
# /etc/sudoers locks everyone out of sudo.
sudo cp /etc/sudoers /tmp/sudoers.new
printf '%%devops ALL=(ALL) ALL\n' | sudo tee -a /tmp/sudoers.new >/dev/null
sudo visudo -c -f /tmp/sudoers.new
sudo install -m 0440 -o root -g root /tmp/sudoers.new /etc/sudoers
```

`solutions/03-primary-group-only.sh`:

This one is a **solution**, not an anti-solution, and the distinction is the
whole point of it. It makes `devops` each user's *primary* group instead of a
secondary one, and everything passes — so it belongs in `solutions/`, where the
harness requires every checkpoint to pass, rather than in `antisolutions/`,
where a missing `# expect-fail:` header is a fatal parse error and where the
file would be asserting the opposite of what it demonstrates.

```bash
#!/usr/bin/env bash
# Made devops each user's *primary* group instead of adding it as a secondary
# one. Everything passes, which is the point: this is a correct answer that a
# naive grader might reject, so it is here to prove the grader accepts it.
#
# A third genuinely independent path: id -nG lists primary groups too. If
# validate reports a failure here, the membership checkpoints are testing the
# mechanism rather than the end state - fix the grader, not this file.
set -euo pipefail
sudo groupadd -g 5000 devops
sudo useradd -g devops alice
sudo useradd -g devops bob
sudo useradd -g devops -e 2027-06-30 carol
sudo chage -M 30 alice
printf '%%devops ALL=(ALL) ALL\n' | sudo tee /etc/sudoers.d/devops >/dev/null
sudo chmod 0440 /etc/sudoers.d/devops
```

`antisolutions/02-no-group-no-sudo.sh`:

```bash
#!/usr/bin/env bash
# Created the accounts and stopped. sudo-devops fails as a consequence of the
# missing membership, not on its own - which is worth seeing, because it shows
# the checkpoints are not independent of each other.
# expect-fail: alice-in-devops, bob-in-devops, carol-in-devops, sudo-devops
set -euo pipefail
sudo groupadd -g 5000 devops
sudo useradd alice
sudo useradd bob
sudo useradd carol
sudo chage -E 2027-06-30 carol
sudo chage -M 30 alice
```

`antisolutions/03-aging-skipped.sh`:

```bash
#!/usr/bin/env bash
# The half of this task that leaves no visible trace: accounts and sudo are
# right, password aging was never touched. Also uses the wrong GID, because a
# grader that only counts "does the group exist" is a common mistake.
# expect-fail: group-gid, carol-expiry, alice-maxdays
set -euo pipefail
sudo groupadd devops
sudo useradd -G devops alice
sudo useradd -G devops bob
sudo useradd -G devops carol
printf '%%devops ALL=(ALL) ALL\n' | sudo tee /etc/sudoers.d/devops >/dev/null
sudo chmod 0440 /etc/sudoers.d/devops
```

- [ ] **Step 2: `content/tasks/selinux/019-httpd-alt-port/`**

`task.yaml`:

```yaml
id: selinux/019-httpd-alt-port
title: Serve a directory on a non-standard port
chapter: 22
scope: instrumental
rhel: 9
objectives:
  - selinux.context.manage
  - selinux.port.manage
  - net.firewall.configure
  - pkg.install
requires_concepts:
  - selinux.labels-now-vs-policy
  - selinux.ports-are-labeled-too
  - net.firewalld-runtime-vs-permanent
difficulty: 4
time_budget: 900
weight: high
editions: [r9, r10]
reboot_check: true
requires_disks: 0
transport: ssh
prompt: |
  The directory /srv/web already contains an index.html. Publish it with
  Apache on TCP port 82.

  - Install and run the httpd service, and make sure it comes back after a
    reboot.
  - Apache must serve /srv/web, not the default document root.
  - The labelling must be correct in a way that survives a full relabel of
    the filesystem, not just until the next one.
  - Port 82/tcp must be reachable from other machines, permanently.

  Leave SELinux in enforcing mode.
```

**`scope: instrumental`.** Configuring Apache is not an EX200 objective — nobody grades your `httpd.conf`. Labelling files, labelling ports, and opening the firewall are. Apache is here because it is the shortest path to a situation where SELinux and firewalld both have to be right, and because the failure is silent in three different ways. The `scope` field is what stops the objective-coverage report from crediting this task with teaching Apache.

`setup.sh`:

```bash
#!/usr/bin/env bash
# Idempotent: undo any previous attempt, then stage the content.
set -uo pipefail

sudo systemctl disable --now httpd &>/dev/null
sudo dnf -y remove httpd &>/dev/null
sudo rm -rf /etc/httpd

sudo semanage port -d -t http_port_t -p tcp 82 &>/dev/null
sudo semanage fcontext -d '/srv/web(/.*)?' &>/dev/null
sudo semanage fcontext -d /srv/web &>/dev/null
sudo firewall-cmd --permanent --remove-port=82/tcp &>/dev/null
sudo firewall-cmd --reload &>/dev/null

sudo mkdir -p /srv/web
printf 'RHCSA-MARKER-8842\n' | sudo tee /srv/web/index.html >/dev/null
sudo chmod 0755 /srv/web
sudo chmod 0644 /srv/web/index.html
# Default label for /srv is var_t, which Apache may not read. Leave it wrong
# on purpose - fixing it is the task.
sudo restorecon -R /srv/web

cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
```

`grade.sh`:

```bash
#!/usr/bin/env bash
# Seven checkpoints, because this task fails silently in more than one way and
# each way needs its own verdict.
#
# Note what is NOT here: nothing greps httpd.conf. Where the DocumentRoot is
# written is not the objective and not the end state - "curl returns the file"
# is.
# baseline-fail: httpd-enabled, page-served, port-labeled, context-now, context-permanent, firewall-runtime, firewall-permanent
set -uo pipefail

systemctl is-enabled httpd &>/dev/null
ck httpd-enabled "httpd is enabled at boot" $? "is-enabled=$(systemctl is-enabled httpd 2>&1)"

# The grader runs inside the guest, and firewalld does not filter loopback, so
# this proves Apache serves the right directory and nothing about the firewall.
# That is why the firewall has checkpoints of its own.
body=$(curl -s --max-time 10 http://localhost:82/ 2>/dev/null)
printf '%s' "$body" | grep -q RHCSA-MARKER-8842
ck page-served "http://localhost:82/ returns the file from /srv/web" $? "got=${body:0:60}"

sudo semanage port -l 2>/dev/null | awk '$1=="http_port_t" && $2=="tcp"' | grep -qw 82
ck port-labeled "82/tcp is labelled http_port_t in policy" $?

now=$(stat -c %C /srv/web/index.html 2>/dev/null)
printf '%s' "$now" | grep -q httpd_sys_content_t
ck context-now "/srv/web/index.html is labelled httpd_sys_content_t right now" $? "context=${now:-none}"

# matchpathcon asks the policy what the label *should* be. It follows both a
# type rule and an equivalence rule, so it accepts either mechanism - and it
# fails for chcon, which changes the label without changing the policy.
want=$(matchpathcon -n /srv/web/index.html 2>/dev/null | tr -d ' ')
printf '%s' "$want" | grep -q httpd_sys_content_t
ck context-permanent "policy would relabel /srv/web to httpd_sys_content_t" $? "matchpathcon=${want:-none}"

sudo firewall-cmd --list-ports 2>/dev/null | grep -qw 82/tcp
ck firewall-runtime "82/tcp is open in the running firewall" $?

sudo firewall-cmd --permanent --list-ports 2>/dev/null | grep -qw 82/tcp
ck firewall-permanent "82/tcp is open in the permanent firewall config" $?

# Invariant: an answer that turns SELinux off is not an answer.
[ "$(getenforce)" = "Enforcing" ]
ck selinux-enforcing "SELinux is still enforcing" $? "getenforce=$(getenforce)"

exit 0
```

`solutions/01-semanage-fcontext-type.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
sudo dnf -y install httpd

sudo sed -i 's|^Listen 80$|Listen 82|' /etc/httpd/conf/httpd.conf
sudo sed -i 's|^DocumentRoot "/var/www/html"|DocumentRoot "/srv/web"|' /etc/httpd/conf/httpd.conf
sudo tee -a /etc/httpd/conf/httpd.conf >/dev/null <<'EOF'
<Directory "/srv/web">
    Require all granted
</Directory>
EOF

sudo semanage port -a -t http_port_t -p tcp 82
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/web(/.*)?'
sudo restorecon -Rv /srv/web

sudo firewall-cmd --permanent --add-port=82/tcp
sudo firewall-cmd --reload

sudo systemctl enable --now httpd
```

`solutions/02-drop-in-and-equivalence.sh`:

```bash
#!/usr/bin/env bash
# Independent in three ways:
#   - config goes in a conf.d drop-in, so httpd.conf is untouched
#   - the label comes from an *equivalence* rule, so nothing in the fcontext
#     database mentions httpd_sys_content_t at all
#   - the firewall is changed at runtime and then committed with
#     runtime-to-permanent, so --permanent never appears
# A grader that greps for httpd_sys_content_t in semanage fcontext -l, or for
# --permanent in history, rejects this. Both would be wrong.
set -euo pipefail
sudo dnf -y install httpd

sudo tee /etc/httpd/conf.d/rhcsa-alt.conf >/dev/null <<'EOF'
Listen 82
<VirtualHost *:82>
    DocumentRoot "/srv/web"
    <Directory "/srv/web">
        Require all granted
    </Directory>
</VirtualHost>
EOF
sudo sed -i 's|^Listen 80$|#Listen 80|' /etc/httpd/conf/httpd.conf

sudo semanage port -a -t http_port_t -p tcp 82
sudo semanage fcontext -a -e /var/www/html /srv/web
sudo restorecon -R /srv/web

sudo firewall-cmd --add-port=82/tcp
sudo firewall-cmd --runtime-to-permanent

sudo systemctl enable httpd
sudo systemctl start httpd
```

`antisolutions/01-chcon-only.sh`:

```bash
#!/usr/bin/env bash
# The reason context-permanent exists. chcon writes the label onto the inode,
# so everything works and keeps working across reboots - until something runs
# restorecon or the filesystem is relabelled, and then the site breaks with no
# change to any config file.
#
# Note that this anti-solution passes the reboot check. A reboot is not the
# only kind of durability, and this is the case that proves it.
# expect-fail: context-permanent
set -euo pipefail
sudo dnf -y install httpd
sudo sed -i 's|^Listen 80$|Listen 82|' /etc/httpd/conf/httpd.conf
sudo sed -i 's|^DocumentRoot "/var/www/html"|DocumentRoot "/srv/web"|' /etc/httpd/conf/httpd.conf
sudo tee -a /etc/httpd/conf/httpd.conf >/dev/null <<'EOF'
<Directory "/srv/web">
    Require all granted
</Directory>
EOF
sudo semanage port -a -t http_port_t -p tcp 82
sudo chcon -R -t httpd_sys_content_t /srv/web
sudo firewall-cmd --permanent --add-port=82/tcp
sudo firewall-cmd --reload
sudo systemctl enable --now httpd
```

`antisolutions/02-runtime-firewall-only.sh`:

```bash
#!/usr/bin/env bash
# firewall-cmd without --permanent. Open now, closed after a reboot - and the
# page still loads from inside the machine either way, which is exactly how
# people convince themselves it worked.
# expect-fail: firewall-permanent, firewall-runtime@post
set -euo pipefail
sudo dnf -y install httpd
sudo sed -i 's|^Listen 80$|Listen 82|' /etc/httpd/conf/httpd.conf
sudo sed -i 's|^DocumentRoot "/var/www/html"|DocumentRoot "/srv/web"|' /etc/httpd/conf/httpd.conf
sudo tee -a /etc/httpd/conf/httpd.conf >/dev/null <<'EOF'
<Directory "/srv/web">
    Require all granted
</Directory>
EOF
sudo semanage port -a -t http_port_t -p tcp 82
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/web(/.*)?'
sudo restorecon -R /srv/web
sudo firewall-cmd --add-port=82/tcp
sudo systemctl enable --now httpd
```

`antisolutions/03-forgot-port-label.sh`:

```bash
#!/usr/bin/env bash
# Everything right except the port label, so httpd cannot bind and
# systemctl start fails. The error message says "Permission denied" on a
# perfectly free port, which is the single most confusing SELinux failure
# there is.
#
# httpd-enabled still passes: enable succeeds even though start does not.
# expect-fail: port-labeled, page-served
set -euo pipefail
sudo dnf -y install httpd
sudo sed -i 's|^Listen 80$|Listen 82|' /etc/httpd/conf/httpd.conf
sudo sed -i 's|^DocumentRoot "/var/www/html"|DocumentRoot "/srv/web"|' /etc/httpd/conf/httpd.conf
sudo tee -a /etc/httpd/conf/httpd.conf >/dev/null <<'EOF'
<Directory "/srv/web">
    Require all granted
</Directory>
EOF
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/web(/.*)?'
sudo restorecon -R /srv/web
sudo firewall-cmd --permanent --add-port=82/tcp
sudo firewall-cmd --reload
sudo systemctl enable httpd
sudo systemctl start httpd || true
```

- [ ] **Step 3: `content/tasks/systemd/017-boot-time-service/`**

`task.yaml`:

```yaml
id: systemd/017-boot-time-service
title: Run a script at every boot
chapter: 11
scope: exam-objective
rhel: 9
objectives:
  - systemd.units.manage
  - systemd.units.create
  - boot.target.set
requires_concepts:
  - systemd.enabled-vs-started
  - systemd.unit-file-anatomy
difficulty: 3
time_budget: 600
weight: medium
editions: [r9, r10]
reboot_check: true
requires_disks: 0
transport: ssh
prompt: |
  /usr/local/bin/rhcsa-stamp already exists and works: it writes a file to
  /run when it runs.

  - Create a systemd service named rhcsa-stamp.service that runs it once at
    every boot.
  - The service must start automatically. Nobody is going to run it by hand.
  - Make sure the system boots to a text login, not a graphical one.

  Leave sshd alone.
```

**Why the stamp file lives in `/run`.** `/run` is a tmpfs — it is empty on every boot. So a marker there cannot have been left behind by a manual `systemctl start`: if the file is present *after* the reboot, the unit ran at boot. That turns the ordinary two-verdict harness into a real test of "did you enable it, or did you just start it", which is the single most common systemd mistake and one that no amount of `systemctl status` inspection reveals.

`setup.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail

sudo systemctl disable --now rhcsa-stamp.service &>/dev/null
sudo rm -f /etc/systemd/system/rhcsa-stamp.service
sudo rm -f /run/rhcsa-stamp
sudo systemctl daemon-reload

sudo tee /usr/local/bin/rhcsa-stamp >/dev/null <<'EOF'
#!/usr/bin/env bash
printf 'stamped\n' > /run/rhcsa-stamp
EOF
sudo chmod 0755 /usr/local/bin/rhcsa-stamp
sudo restorecon /usr/local/bin/rhcsa-stamp

sudo systemctl set-default multi-user.target &>/dev/null
sudo systemctl enable sshd &>/dev/null

cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
```

Note that `setup.sh` sets the default target to `multi-user.target` — the value the prompt asks for. That looks wrong, and it is not: the checkpoint for it is therefore an **invariant**, listed below but absent from `# baseline-fail:`. The point of the instruction is that a student who reaches for `systemctl set-default graphical.target` out of habit breaks something that was already right, and the anti-solution proves the grader notices.

`grade.sh`:

```bash
#!/usr/bin/env bash
# baseline-fail: unit-verifies, stamp-enabled, stamp-effect
set -uo pipefail

unit=/etc/systemd/system/rhcsa-stamp.service
# systemd-analyze verify is the real parser: it catches a missing [Install]
# section, a typo'd directive, and an ExecStart that does not exist.
sudo systemd-analyze verify rhcsa-stamp.service &>/dev/null
ck unit-verifies "rhcsa-stamp.service exists and systemd accepts it" $? \
  "unit_file=$([ -f "$unit" ] && echo present || echo missing)"

# is-enabled covers enabled and enabled-runtime, and also "static" - which is
# why the grep is anchored: a static unit is not what was asked for.
state=$(systemctl is-enabled rhcsa-stamp.service 2>&1)
printf '%s' "$state" | grep -qx enabled
ck stamp-enabled "rhcsa-stamp.service is enabled" $? "is-enabled=$state"

# Before the reboot this only proves the unit can run. After the reboot, /run
# has been wiped, so the file can only exist because systemd ran the unit at
# boot - which is the actual requirement.
[ -f /run/rhcsa-stamp ]
ck stamp-effect "/run/rhcsa-stamp exists (after the reboot: it ran at boot)" $?

target=$(systemctl get-default 2>&1)
[ "$target" = "multi-user.target" ]
ck default-target "the system boots to multi-user.target" $? "get-default=$target"

systemctl is-enabled sshd &>/dev/null
ck sshd-intact "sshd is still enabled" $?

exit 0
```

`solutions/01-oneshot-multiuser.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
sudo tee /etc/systemd/system/rhcsa-stamp.service >/dev/null <<'EOF'
[Unit]
Description=Write a boot stamp to /run

[Service]
Type=oneshot
ExecStart=/usr/local/bin/rhcsa-stamp
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now rhcsa-stamp.service
```

`solutions/02-simple-sysinit.sh`:

```bash
#!/usr/bin/env bash
# Independent: Type=simple instead of oneshot, wanted by sysinit.target instead
# of multi-user.target, and enabled with `systemctl enable` plus a separate
# start rather than `enable --now`. All correct - the unit still runs once at
# every boot - and it fails any grader that diffs the unit file against an
# expected text.
set -euo pipefail
sudo tee /etc/systemd/system/rhcsa-stamp.service >/dev/null <<'EOF'
[Unit]
Description=Boot stamp
DefaultDependencies=no
After=local-fs.target
Requires=local-fs.target

[Service]
Type=simple
ExecStart=/usr/local/bin/rhcsa-stamp

[Install]
WantedBy=sysinit.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable rhcsa-stamp.service
sudo systemctl start rhcsa-stamp.service
```

`antisolutions/01-started-not-enabled.sh`:

```bash
#!/usr/bin/env bash
# The unit is perfect and it was started by hand. Everything looks right in
# systemctl status. Nothing survives the reboot.
# expect-fail: stamp-enabled, stamp-effect@post
set -euo pipefail
sudo tee /etc/systemd/system/rhcsa-stamp.service >/dev/null <<'EOF'
[Unit]
Description=Write a boot stamp to /run

[Service]
Type=oneshot
ExecStart=/usr/local/bin/rhcsa-stamp
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl start rhcsa-stamp.service
```

`antisolutions/02-faked-the-end-state.sh`:

```bash
#!/usr/bin/env bash
# Ran the script instead of building the service. The stamp file is there, so a
# grader that only checks for the file would pass this.
# expect-fail: unit-verifies, stamp-enabled, stamp-effect@post
set -euo pipefail
sudo /usr/local/bin/rhcsa-stamp
```

`antisolutions/03-broke-the-target.sh`:

```bash
#!/usr/bin/env bash
# Did the service correctly and then changed the default target it was never
# asked to change. default-target is an invariant, so this is the fixture that
# proves invariants are actually evaluated.
# expect-fail: default-target
set -euo pipefail
sudo tee /etc/systemd/system/rhcsa-stamp.service >/dev/null <<'EOF'
[Unit]
Description=Write a boot stamp to /run

[Service]
Type=oneshot
ExecStart=/usr/local/bin/rhcsa-stamp
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now rhcsa-stamp.service
sudo systemctl set-default graphical.target
```

**Safety note on anti-solution 03.** `set-default graphical.target` on a Server install is safe: `graphical.target` pulls in `multi-user.target` and, with no display manager installed, the machine still ends at a text login and stays reachable. It is the mildest available way to break an invariant, which is why it was chosen over anything involving `rescue.target`.

- [ ] **Step 4: `content/tasks/troubleshooting/028-restore-remote-access/`**

`task.yaml`:

```yaml
id: troubleshooting/028-restore-remote-access
title: Nobody can SSH to this machine
chapter: 26
scope: exam-objective
rhel: 9
objectives:
  - net.ssh.configure
  - net.firewall.configure
  - net.nm.configure
  - systemd.units.manage
requires_concepts:
  - systemd.enabled-vs-started
  - net.firewalld-runtime-vs-permanent
  - net.nm-connections-are-the-config
difficulty: 4
time_budget: 900
weight: high
editions: [r9, r10]
reboot_check: true
requires_disks: 0
transport: vmrun
prompt: |
  This machine has stopped accepting SSH connections and you are at the
  console. Somebody changed three things.

  Restore remote access so that it works now and after a reboot:

  - sshd must be running and must start at boot.
  - The firewall must allow ssh, permanently.
  - The machine's network connection must come up on its own at boot.

  Find the three problems yourself. Do not reinstall anything.
```

**This is the only task in Phase 1 that requires `transport: vmrun`, and that is the entire reason it exists.** `setup.sh` disables `sshd` and closes the firewall, so the SSH control plane is gone before the student types anything. If the grader could only reach the guest over SSH, this whole family of RHCSA questions — the ones where you are handed a broken machine — would be unbuildable. Running it once proves the dual control plane is real under the conditions it was designed for, not just when `sshd` is stopped by hand during Task 18's acceptance.

`setup.sh`:

```bash
#!/usr/bin/env bash
# Break three things, and record the connection name so grade.sh does not have
# to guess it. Idempotent: every step is already the desired end state on a
# second run.
set -uo pipefail

conn=$(nmcli -t -f NAME connection show --active 2>/dev/null | head -1)
if [ -z "$conn" ]; then
  conn=$(nmcli -t -f NAME connection show 2>/dev/null | head -1)
fi
printf '%s\n' "$conn" | sudo tee /etc/rhcsa-conn >/dev/null

# 1. the service
sudo systemctl disable --now sshd &>/dev/null
# 2. the firewall
sudo firewall-cmd --permanent --remove-service=ssh &>/dev/null
sudo firewall-cmd --reload &>/dev/null
# 3. the connection - autoconnect only, so the network stays up until the next
#    boot. Taking the interface down here would make the break obvious and
#    would also strand the student's own console session if they are on one.
sudo nmcli connection modify "$conn" connection.autoconnect no &>/dev/null

sudo usermod -aG wheel student &>/dev/null

cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
```

`grade.sh`:

```bash
#!/usr/bin/env bash
# Four goal checkpoints, all of which must hold in both verdicts, plus one
# invariant.
#
# There is deliberately no "does the machine have an IP" checkpoint. It would
# pass before the reboot and fail after it for the autoconnect case, and a
# checkpoint whose meaning changes between the two verdicts is a checkpoint
# nobody can interpret. net-autoconnect tests the same thing by reading the
# configuration, in both phases, unambiguously.
# baseline-fail: sshd-enabled, sshd-listening, firewall-ssh, net-autoconnect
set -uo pipefail

systemctl is-enabled sshd &>/dev/null
ck sshd-enabled "sshd is enabled at boot" $? "is-enabled=$(systemctl is-enabled sshd 2>&1)"

# ss over systemctl is-active: what matters is that something is listening on
# 22, not which unit put it there.
ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -qE '(^|:)22$'
ck sshd-listening "something is listening on TCP 22" $?

# --permanent covers both verdicts: if it is in the permanent config it is in
# the runtime config after the reboot, and the runtime check below would be
# redundant with sshd-listening before it.
# Both spellings count. --add-service=ssh and --add-port=22/tcp are equally
# correct answers, and spec 6.5 rule 1 forbids grading the mechanism, so
# accepting only the named service would fail a correct solution.
perm=$(sudo firewall-cmd --permanent --list-all 2>/dev/null)
grep -qw ssh <<<"$perm" || grep -qw 22/tcp <<<"$perm"
ck firewall-ssh "the firewall permits ssh permanently" $?

conn=$(cat /etc/rhcsa-conn 2>/dev/null)
auto=$(nmcli -g connection.autoconnect connection show "$conn" 2>/dev/null)
[ "$auto" = "yes" ]
ck net-autoconnect "connection '$conn' comes up automatically" $? "autoconnect=${auto:-unknown}"

id -nG student | tr ' ' '\n' | grep -qx wheel
ck student-intact "the student account is still in wheel" $?

exit 0
```

`solutions/01-systemctl-firewallcmd-nmcli.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
sudo systemctl enable --now sshd
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --reload
sudo nmcli connection modify "$(cat /etc/rhcsa-conn)" connection.autoconnect yes
```

`solutions/02-by-port-and-keyfile.sh`:

```bash
#!/usr/bin/env bash
# Independent in all three fixes: the firewall gets the port rather than the
# named service, autoconnect is set by editing the keyfile and reloading rather
# than through nmcli, and sshd is enabled and started as two operations.
# --add-port=22/tcp is a correct way to permit ssh, and this file adds *only*
# the port - not the named service as well - so its independence from solution
# 01 is real. The checkpoint accepts either spelling out of --list-all.
set -euo pipefail
sudo systemctl enable sshd
sudo systemctl start sshd

sudo firewall-cmd --permanent --add-port=22/tcp
sudo firewall-cmd --reload

conn=$(cat /etc/rhcsa-conn)
# NAME,FILENAME in list mode, then pick the row out with awk. FILENAME is a
# list-mode field: the profile-mode form of `connection show` takes
# <setting>.<property> and cannot return it, so `-g FILENAME connection show
# "$conn"` fails - and under `set -euo pipefail` that aborts the whole script.
file=$(sudo nmcli -g NAME,FILENAME connection show | awk -F: -v c="$conn" '$1==c{print $2; exit}')
sudo sed -i '/^autoconnect=/d' "$file"
sudo sed -i "/^\[connection\]/a autoconnect=true" "$file"
sudo nmcli connection reload
```

`antisolutions/01-started-not-enabled.sh`:

```bash
#!/usr/bin/env bash
# Fixed all three symptoms for right now. After the reboot sshd is gone again,
# which is what @post is expressing: the service is not enabled, so nothing is
# listening.
# expect-fail: sshd-enabled, sshd-listening@post
set -euo pipefail
sudo systemctl start sshd
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --reload
sudo nmcli connection modify "$(cat /etc/rhcsa-conn)" connection.autoconnect yes
```

`antisolutions/02-runtime-firewall-only.sh`:

```bash
#!/usr/bin/env bash
# The firewall is open in the running config and nowhere else. Note that
# sshd-listening still passes after the reboot: sshd binds regardless of what
# firewalld does, so a student testing with `ss -ltn` from the console sees a
# healthy machine that no other host can reach. That is the failure this
# checkpoint exists for.
# expect-fail: firewall-ssh
set -euo pipefail
sudo systemctl enable --now sshd
sudo firewall-cmd --add-service=ssh
sudo nmcli connection modify "$(cat /etc/rhcsa-conn)" connection.autoconnect yes
```

`antisolutions/03-network-left-manual.sh`:

```bash
#!/usr/bin/env bash
# The two obvious problems fixed and the third missed, because the network is
# working right now and gives no reason to look. After the reboot the machine
# has no address and is unreachable no matter how healthy sshd is.
# expect-fail: net-autoconnect
set -euo pipefail
sudo systemctl enable --now sshd
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --reload
sudo nmcli connection up "$(cat /etc/rhcsa-conn)"
```

**Expected duration.** Six fixtures, each with a revert and a reboot, all over `vmrun` (which is slower than SSH because every command round-trips a file into the guest). Budget 20–25 minutes for this task's `validate` run and do not interpret slowness as a hang.

- [ ] **Step 5: Write the concept cards for the users and SELinux tasks**

`content/concepts/users/shadow-aging-fields.md`:

```markdown
---
id: users.shadow-aging-fields
title: Reading /etc/shadow
rhel: 9
objectives: [users.password.aging, users.accounts.manage]
sources: [r9:ch6, r10:ch6]
---
Password aging looks like a pile of unrelated commands until you see that all
of them write to the same nine colon-separated fields of one line in
`/etc/shadow`. Learn the line and the commands stop mattering.

```
student:$6$xxxx:19800:0:30:7:14:20000:
   1      2       3   4  5 6  7    8  9
```

1. **username**
2. **hashed password** — `!` or `!!` at the front means locked, `*` means the
   account can never log in with a password, empty means no password at all
3. **last change**, in days since 1 Jan 1970
4. **minimum days** before the password may be changed again
5. **maximum days** the password is valid — this is `chage -M`
6. **warning days** before expiry
7. **inactive days** after expiry before the account is disabled
8. **account expiry date**, again in days since the epoch — this is `chage -E`
9. unused

Two of these are constantly confused. **Field 5 expires the password**: the
user is forced to choose a new one and can still get in. **Field 8 expires the
account**: the user cannot log in at all, no matter what the password is. A
question about a contractor's last day means field 8. A question about a
security policy means field 5.

Three ways to write the same thing:

```
chage -M 30 alice        # field 5
passwd -x 30 alice       # field 5, same result
chage -E 2027-06-30 carol   # field 8, converted to days for you
```

Read it back with `chage -l alice`, which prints the fields as dates, or with
`getent shadow alice` if you want to see the raw numbers. `getent` needs root —
`/etc/shadow` is mode 000 by design.

The gotcha worth remembering: `chage -E` accepts a date, but field 8 stores a
day count, so a value of `0` does not mean "never" — it means 1 Jan 1970, and
the account is expired. "Never" is `-1`, written as `chage -E -1`.
```

`content/concepts/users/sudoers-and-wheel.md`:

```markdown
---
id: users.sudoers-and-wheel
title: How sudo decides
rhel: 9
objectives: [users.sudo.configure]
sources: [r9:ch6, r10:ch6]
---
On RHEL, `sudo` reads `/etc/sudoers`, and the last line of that file is
`#includedir /etc/sudoers.d`. Both places are equally real. A rule in a file in
`/etc/sudoers.d` is not a lesser rule, and it is the one to prefer: your
changes stay separate from the package's file, and removing a grant is
`rm` rather than an edit.

A rule reads left to right:

```
%devops    ALL=(ALL)      ALL
  who   which hosts  as whom  what commands
```

`%` in front means a group; without it, a user name. `ALL=` is the host field,
a leftover from sharing one sudoers file across a fleet — on a single machine
it is always `ALL`. `(ALL)` is who you may become. The final field is the
commands, and it can be a list of absolute paths instead of `ALL`. Adding
`NOPASSWD:` before the commands drops the password prompt.

RHEL ships one grant already: `%wheel ALL=(ALL) ALL`. That is why "give this
person admin rights" is usually `usermod -aG wheel bob` and nothing else — you
almost never need to write a rule to solve that. Writing a new group's rule is
for when the grant needs to be narrower than "everything", or when the group is
not `wheel`.

**Always validate.** A syntax error in `/etc/sudoers` breaks `sudo` for
everyone, including you, and the message you get is not a helpful one. `visudo`
edits the file and refuses to install a broken version; `visudo -c` checks the
files that are already there; `visudo -c -f /path` checks a candidate before you
move it into place. `sudo -l -U bob` answers the question you actually care
about — what may this person run — by asking the same parser `sudo` uses.

Two habits that prevent the common failures: files in `/etc/sudoers.d` must be
mode `0440` and owned by root, and their names must not contain a dot or a `~`,
or the include directive skips them silently.
```

`content/concepts/selinux/labels-now-vs-policy.md`:

```markdown
---
id: selinux.labels-now-vs-policy
title: The label on the file and the label the policy wants
rhel: 9
objectives: [selinux.context.manage]
sources: [r9:ch22, r10:ch22]
---
There are two answers to "what is the SELinux context of this file", and
knowing which one you are looking at is most of SELinux troubleshooting.

**The label right now** is stored in an extended attribute on the inode. See it
with `ls -Z`, `stat -c %C`, or `ps -Z` for processes. `chcon` writes this
attribute directly.

**The label the policy wants** comes from a database of path patterns, most of
it shipped by the distribution and the rest of it yours. See what the policy
would assign with `matchpathcon /path` (or `semanage fcontext -l` to read the
rules themselves). `semanage fcontext -a` adds to this database.

`restorecon` is the bridge: it asks the policy what the label should be and
writes that onto the inode. `restorecon -Rv /srv/web` after a `semanage
fcontext -a` is the normal two-step, and the reason for the two steps is that
the first one changes what *should* be true and the second makes it true.

This is why `chcon` is a trap. It works. The site comes up. It survives
reboots. And then someone runs `restorecon`, or the filesystem gets relabelled
after a policy update, or a file is created fresh in that directory — and the
label reverts to whatever the policy says, because the policy never knew about
your change. A `chcon` fix is a fix with a fuse on it. Use `chcon` to test a
hypothesis in ten seconds; use `semanage fcontext` + `restorecon` to fix
anything you intend to keep.

Two more things worth knowing. A **file inherits the label of the directory it
is created in**, which is why copying a file into a directory gives it the
right label and moving one in with `mv` does not — `mv` preserves the
attribute. And an **equivalence rule**, `semanage fcontext -a -e /var/www/html
/srv/web`, says "label this tree exactly the way you label that one". It is
shorter and more accurate than reproducing a set of type rules by hand, and it
is a completely legitimate answer that looks nothing like the type-rule answer.

When a service cannot read a file it plainly has Unix permission to read, the
sequence is: `ls -Z` the file, `matchpathcon` the file, and if they disagree run
`restorecon`. If they agree and it still fails, the problem is not the file
label — look at `ausearch -m AVC -ts recent` and at the booleans.
```

`content/concepts/selinux/ports-are-labeled-too.md`:

```markdown
---
id: selinux.ports-are-labeled-too
title: Ports have SELinux types
rhel: 9
objectives: [selinux.port.manage]
sources: [r9:ch22, r10:ch22]
prerequisites: [selinux.labels-now-vs-policy]
---
SELinux does not only label files. TCP and UDP port numbers are labelled too,
and a confined service may only bind a port whose type its policy allows.
`httpd` is allowed `http_port_t`, which by default covers 80, 443, 8080 and a
few others. Port 82 is not in that list.

So this happens:

```
# systemctl start httpd
Job for httpd.service failed.
# journalctl -u httpd
(98)Address already in use: AH00072: make_sock: could not bind to 0.0.0.0:82
```

Nothing is using port 82. `ss -ltn` shows it free. The message is wrong because
Apache is reporting a generic bind failure for a permission denial it does not
understand. This is the most misleading error in the whole SELinux surface, and
recognising it — a bind failure on a port that is demonstrably free — is worth
more than any command.

The fix is one line:

```
semanage port -a -t http_port_t -p tcp 82
```

`-a` adds, `-m` modifies an existing entry, `-d` deletes. List what is already
labelled with `semanage port -l`, and narrow it with
`semanage port -l | grep http`. There is no "restorecon for ports": the policy
database *is* the state, so unlike file contexts this is a one-step change and
it is permanent as soon as you make it.

The habit: when a service refuses to start on a port you chose yourself, and
the port is free, check `semanage port -l` before you check anything else. When
the port is one the service already owns, SELinux is not your problem.
```

- [ ] **Step 6: Write the concept cards for the firewall, systemd and NetworkManager tasks**

`content/concepts/net/firewalld-runtime-vs-permanent.md`:

```markdown
---
id: net.firewalld-runtime-vs-permanent
title: firewalld keeps two copies of everything
rhel: 9
objectives: [net.firewall.configure]
sources: [r9:ch25, r10:ch25]
---
firewalld holds two configurations at once. The **runtime** configuration is
what is filtering packets this second. The **permanent** configuration is what
will be loaded at the next boot or reload. `firewall-cmd` writes to one or the
other, never both, and which one depends on a flag that is easy to forget.

```
firewall-cmd --add-service=ssh                # runtime only - gone at reboot
firewall-cmd --permanent --add-service=ssh    # permanent only - not active yet
firewall-cmd --permanent --add-service=ssh && firewall-cmd --reload   # both
firewall-cmd --add-service=ssh && firewall-cmd --runtime-to-permanent # both
```

The last two are equally correct and it is worth being fluent in both.
`--permanent` then `--reload` is the one to reach for when you know what you
want. `--runtime-to-permanent` is the one for when you have been experimenting:
it commits whatever is currently working, which is exactly the situation where
retyping the commands with `--permanent` invites a typo.

**`--reload` discards the runtime configuration** and replaces it with the
permanent one. That is the point of it, and it is also the trap: any change you
made without `--permanent` disappears the moment you reload for an unrelated
reason. A rule that works and then vanishes an hour later was a runtime rule.

Read the two copies separately and compare them — this is the single most
useful firewalld diagnostic:

```
firewall-cmd --list-all               # runtime
firewall-cmd --permanent --list-all   # permanent
```

If they differ, you have found the bug. Note that `--list-all` prints services
*and* ports, while `--list-services` prints only services — so a rule added as
`--add-port=22/tcp` is invisible to `--list-services` even though it permits
ssh perfectly well. Two spellings, one effect: `--add-service=ssh` looks up the
port in `/usr/lib/firewalld/services/ssh.xml`, and `--add-port=22/tcp` says it
directly. Prefer the service name when one exists, because it stays right if
the service's ports ever change.

Everything above is per-zone, and every command silently means `--zone=public`
unless you say otherwise. `firewall-cmd --get-active-zones` tells you which
zone your interface is actually in, and a rule added to the wrong zone has no
effect at all while looking perfectly correct in `--list-all`.
```

`content/concepts/systemd/enabled-vs-started.md`:

```markdown
---
id: systemd.enabled-vs-started
title: Started, enabled, and why they are unrelated
rhel: 9
objectives: [systemd.units.manage]
sources: [r9:ch11, r10:ch11]
---
**Started** means the unit is running right now. **Enabled** means it will be
started at the next boot. They are independent: a unit can be any of the four
combinations, and three of them are bugs somebody is going to hit.

```
systemctl start sshd     # running now, nothing about boot
systemctl enable sshd    # will start at boot, not running now
systemctl enable --now sshd     # both
systemctl is-active sshd ; systemctl is-enabled sshd   # ask about each
```

`enable` does one concrete thing: it reads the unit's `[Install]` section and
creates a symlink under `/etc/systemd/system/<target>.wants/`. That is the whole
mechanism. It follows that a unit file with no `[Install]` section cannot be
enabled — `systemctl enable` reports `The unit files have no installation
config` — and that `is-enabled` returning `static` means exactly that: the unit
exists, it is fine, and nothing will ever pull it in by name.

`is-enabled` has more answers than yes and no, and they are worth recognising:
`enabled` (a symlink in `/etc`), `enabled-runtime` (a symlink in `/run`, which
disappears at reboot — `enable --runtime` did this), `disabled`, `static` (no
`[Install]`), `masked` (symlinked to `/dev/null`, which makes the unit
unstartable even by hand), and `indirect`.

**Masking is the one to remember for troubleshooting.** `systemctl mask foo`
makes `start` fail with a message about the unit being masked; `disable` alone
never does that. If a service refuses to start and the error mentions masking,
`systemctl unmask` is the fix and no amount of editing the unit file will help.

The habit worth building: after any change to a service, run both checks. "It
works" is `is-active`. "It will still work on Monday" is `is-enabled`. Nearly
every graded systemd question is really asking for the second one, and nearly
every wrong answer satisfies only the first.
```

`content/concepts/systemd/unit-file-anatomy.md`:

```markdown
---
id: systemd.unit-file-anatomy
title: Writing a service unit
rhel: 9
objectives: [systemd.units.create]
sources: [r9:ch11, r10:ch11]
prerequisites: [systemd.enabled-vs-started]
---
A service unit is an ini file with three sections, and you can write a working
one from memory once you know what each section is for.

```ini
[Unit]
Description=Write a boot stamp to /run
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/rhcsa-stamp
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

`[Unit]` is metadata and ordering. `Description` is what `systemctl status`
prints. `After=` and `Before=` control *order* only; `Requires=` and `Wants=`
control *whether* something else gets pulled in. Mixing those up produces a
unit that starts too early rather than one that fails, which is harder to spot.

`[Service]` is the process. `Type=simple` is the default and means "ExecStart is
the daemon; consider it started as soon as it is forked". `Type=oneshot` means
"ExecStart is a job that exits", and is what you want for a script — pair it
with `RemainAfterExit=yes` so the unit shows as `active (exited)` rather than
flapping to inactive the instant it finishes. `Type=forking` is for old daemons
that background themselves. `ExecStart` must be an **absolute path**; there is
no shell, so pipes and globs do not work unless you invoke a shell explicitly.

`[Install]` is only read by `systemctl enable`, and `WantedBy=` names the target
whose `.wants` directory gets the symlink. `multi-user.target` is the normal
answer. Leave this section out and the unit cannot be enabled at all.

Where the file goes matters: **`/etc/systemd/system/` for anything you write**.
`/usr/lib/systemd/system/` belongs to packages and your file there will be
overwritten by an update. A file in `/etc` with the same name overrides the one
in `/usr/lib` entirely; if you only want to change one directive of a packaged
unit, use `systemctl edit foo` instead, which creates a drop-in under
`/etc/systemd/system/foo.service.d/override.conf` and leaves the rest alone.

Two commands after every edit. `systemctl daemon-reload` — systemd caches unit
files and will keep using the old one until you say this. And
`systemd-analyze verify foo.service`, which parses the unit the way systemd
does and reports typo'd directives, a missing `[Install]`, and an `ExecStart`
path that does not exist. It costs a second and catches the mistakes that
otherwise show up as a failed boot.
```

`content/concepts/net/nm-connections-are-the-config.md`:

```markdown
---
id: net.nm-connections-are-the-config
title: NetworkManager connections, not interfaces
rhel: 9
objectives: [net.nm.configure]
sources: [r9:ch24, r10:ch24]
---
On RHEL the network is not configured by editing an interface. It is configured
by editing a **connection profile**, and NetworkManager applies the profile to a
device. Two different things with two different names, and every confusing
`nmcli` session comes from conflating them.

- A **device** is hardware: `ens160`. `nmcli device status` lists them.
- A **connection** is a saved set of settings that can be applied to a device:
  `ens160`, `Wired connection 1`, whatever it was named at install. `nmcli
  connection show` lists them. The profile is a keyfile under
  `/etc/NetworkManager/system-connections/`.

A device can have several profiles available and at most one active. This is why
`ip addr add` "works" and then vanishes — you changed the device, not the
profile, and NetworkManager will overwrite it at the next opportunity. On RHEL,
`ip` is a diagnostic tool. `nmcli` is the configuration tool.

The four commands that cover most of it:

```
nmcli connection show                          # what profiles exist
nmcli connection show "ens160"                 # every setting, one per line
nmcli connection modify "ens160" ipv4.addresses 192.168.1.50/24 \
      ipv4.gateway 192.168.1.1 ipv4.method manual
nmcli connection up "ens160"                   # apply the change now
```

`modify` writes the profile to disk immediately and does **not** apply it. `up`
applies it. So a change that has no effect usually just needs `up` — and a
change that works but disappears at reboot was made with `ip` instead of
`nmcli`, or was made to a profile that is not the one that comes up at boot.

**`connection.autoconnect` is the one to check when a machine boots with no
network.** Set to `no`, the profile is perfectly correct and NetworkManager
simply never applies it; the machine comes up with a link and no address, and
nothing in the profile looks wrong. Read it with
`nmcli -g connection.autoconnect connection show "<name>"` and fix it with
`nmcli connection modify "<name>" connection.autoconnect yes`.

`-g` is worth knowing generally: it prints one field with no padding and no
header, which makes it the right way to ask a specific question rather than
grepping the human-readable output. And `nmcli connection reload` re-reads the
keyfiles from disk, which is what you need if you edited one by hand instead of
going through `nmcli`.
```

- [ ] **Step 7: Check the content loads and every reference resolves**

Run:
```bash
cd /home/daxtangco/rhcsa-trainer
node src/cli/index.ts coverage; echo "exit=$?"
```

Expected: `tasks: 5`, `concepts: 10`, `untaught concepts: 0`, no `problem:` lines, `exit=0`.

`untaught concepts: 0` proves every card written above is reachable from some task's `requires_concepts`. A `problem: ... maps to unknown objective` line means an id in a `task.yaml` or a card's `objectives:` does not exist in `objectives.yaml` — fix the task or the card to match the transcription, not the other way round.

- [ ] **Step 8: Syntax-check every script and cross-check every declared id**

Run:
```bash
cd /home/daxtangco/rhcsa-trainer
find content/tasks -name '*.sh' -print0 | while IFS= read -r -d '' f; do
  bash -n "$f" || echo "SYNTAX ERROR: $f"
done
echo "syntax pass complete"
```
Expected: no `SYNTAX ERROR` lines.

Then, for each of the four new tasks, confirm no fixture declares a checkpoint the grader never emits:

```bash
cd /home/daxtangco/rhcsa-trainer
for T in content/tasks/*/*; do
  emitted=$(grep -oE '^[[:space:]]*ck(_pass|_fail|_skip)? [a-z0-9][a-z0-9-]*' "$T/grade.sh" | awk '{print $NF}' | sort -u)
  declared=$(grep -hoE '^# (expect|baseline)-fail:.*' "$T/grade.sh" "$T"/antisolutions/*.sh 2>/dev/null \
    | sed 's/^# [a-z]*-fail://' | tr ',' '\n' | sed 's/@.*//' | tr -d ' ' | sort -u)
  missing=$(comm -13 <(echo "$emitted") <(echo "$declared"))
  [ -n "$missing" ] && printf 'UNDECLARED-ID %s: %s\n' "$T" "$(echo $missing)"
done
echo "id cross-check complete"
```
Expected: no `UNDECLARED-ID` lines. The alternation matters: the graders reach for `ck_pass`, `ck_fail` and `ck_skip` as often as bare `ck`, and a pattern that matched only `ck ` would call a genuinely undeclared id clean. This works only because every emitter's id is a literal — the same property `countCheckpoints` relies on in Task 23.

- [ ] **Step 9: ACCEPTANCE — validate the three SSH tasks**

These three share a transport, so one run covers them. Eighteen fixtures with reverts and (for two of the three) reboots: budget 35–45 minutes.

```bash
cd /home/daxtangco/rhcsa-trainer
node --env-file-if-exists=.env.local src/cli/index.ts validate \
  users/006-team-provisioning \
  selinux/019-httpd-alt-port \
  systemd/017-boot-time-service
echo "exit=$?"
```

Expected: `transport: ssh`, then `ok` for all 18 fixtures, `18/18 fixtures ok`, `exit=0`.

Read failures with the table from Task 21, Step 12. Three failures specific to this batch and what they mean:

| Failure | Diagnosis |
|---|---|
| `users` `antisolution/01-primary-group-only`: `expected pass, got fail` | the membership checkpoints are testing `groups`/`/etc/group` rather than effective membership. `id -nG` is the fix; a primary group is a real membership. |
| `selinux` `antisolution/01-chcon-only`: `context-permanent: expected fail, got pass` | `matchpathcon` is reading the inode instead of the policy — most likely the command was replaced with `ls -Z`. This is the checkpoint the whole task is built around; do not weaken it. |
| `systemd` `solution/02-simple-sysinit`: `stamp-effect: expected pass, got fail` after the reboot | a unit wanted by `sysinit.target` with `DefaultDependencies=no` ordered itself before `/run` was ready. Add `After=local-fs.target` — it is already in the file, so if this fires, check the file was written verbatim. |

- [ ] **Step 10: ACCEPTANCE — validate the vmrun task on its own**

Run it separately: it is the only task that needs `vmrun`, and mixing it in would force all 24 fixtures through the slower transport.

```bash
cd /home/daxtangco/rhcsa-trainer
export RHCSA_GUEST_PASSWORD='<the student account password>'
node --env-file-if-exists=.env.local src/cli/index.ts validate troubleshooting/028-restore-remote-access
echo "exit=$?"
```

Expected: **`transport: vmrun`** on the first line — if it says `ssh`, the `require` derivation from `task.transport` in Task 21's `validate` command is not working and the rest of the run is meaningless. Then `ok` for all 6 fixtures, `6/6 fixtures ok`, `exit=0`.

If this run fails with `guest did not come back within 120000ms`, the guest is fine and the wait is too short — `sshd` being disabled does not slow a boot, but a machine with `connection.autoconnect no` can spend time waiting on `network-online.target`. Raise `VmController.waitForGuest`'s `timeoutMs` rather than changing the task.

**This step is the proof that the dual control plane earns its keep.** It is the first time the grader runs on a machine that SSH cannot reach, and every troubleshooting task in Phase 2 depends on it working.

- [ ] **Step 11: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add content/tasks content/concepts && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(content): four tasks covering the four shapes of RHCSA question

users: pure on-disk state, so reboot_check is false - a reboot would spend 90
seconds per fixture proving something that cannot be non-persistent.

selinux: the case where a reboot check is not enough. chcon survives reboots
and dies at the next relabel, so context-permanent asks matchpathcon what the
policy would assign rather than what the inode currently says.

systemd: the stamp file is written to /run, which is a tmpfs. A marker there
after the reboot can only have been left by systemd starting the unit at boot,
which is what separates 'enabled' from 'started by hand'.

troubleshooting: transport vmrun. setup.sh disables sshd and closes the
firewall, so this task cannot be graded over SSH at all - it is the first proof
that the dual control plane works under the conditions it exists for.

Eight concept cards, one per mechanism the four tasks depend on."
```

---

### Task 23: HTTP API and the terminal bridge

**Files:**
- Create: `src/engine/disclosure/content.ts`
- Test: `test/disclosure/content.test.ts`
- Create: `src/server/session.ts`
- Test: `test/server/session.test.ts`
- Create: `src/server/lab.ts`
- Create: `src/server/app.ts`
- Test: `test/server/app.test.ts`
- Create: `src/server/terminal.ts`
- Test: `test/server/terminal.test.ts`
- Create: `src/server/index.ts`
- Modify: `package.json` (add `hono`, `@hono/node-server`, `ws`, `@types/ws`; add the `dev:server` script)

**Interfaces:**
- Consumes: `Bank`/`loadBank` (T7), `TaskSpec` (T3), `ConceptSpec` (T4), `Objective` (T6), `Verdict`/`Checkpoint`/`CheckpointStatus` (T5), `grade`/`GradeResult` (T8), ladder types (T9), `TaskScripts`/`loadTaskScripts` (T11), `VmConfig` (T17), `VmController` (T17), `chooseTransport` (T18)
- Produces:
  - `type RungKind = 'prompt' | 'nudge' | 'concepts' | 'sketch' | 'solution'`
  - `interface RungContent { rung: Rung; kind: RungKind; title: string; body: string }`
  - `interface RungContext { task: TaskSpec; objectives: Objective[]; concepts: ConceptSpec[]; solution: string }`
  - `function commandSketch(solution: string): string[]`
  - `function rungContent(rung: Rung, ctx: RungContext): RungContent`
  - `type SessionMode = 'guided' | LadderMode`
  - `interface SessionRecord { id; taskId; mode; rung; checkpointTotal; startedAt; endedAt?; phase; result? }`
  - `interface GradeReport { passed; total; allPassed; rebooted; rebootError?; regressionCount; checkpoints?; regressions? }`
  - `function countCheckpoints(gradeScript: string): number`
  - `function reportFor(mode: SessionMode, result: GradeResult, revealed: boolean): GradeReport`
  - `class SessionStore` with `create` / `get` / `list` / `advanceRung` / `restart` / `record` / `finish`
  - `interface LabRuntime { transportKind: TransportKind; reset(): Promise<void>; exec(script: string): Promise<ExecResult>; gradeTask(task: TaskSpec, gradeScript: string): Promise<GradeResult> }`
  - `interface AppDeps` / `function createApp(deps: AppDeps): Hono`
  - `interface PtyLike` / `function attachTerminal(server, deps): WebSocketServer`

- [ ] **Step 1: Install the server dependencies**

Run:
```bash
cd /home/daxtangco/rhcsa-trainer
npm install hono @hono/node-server ws
npm install -D @types/ws
```

There is one terminal implementation and it is `spawnSshPipe`: a plain pipe to `ssh -tt`. No native module, no compiler, nothing to detect at install time. The remote side still gets a real terminal — `ssh -tt` forces one — so `vim`, `less` and `nmtui` all work; what is lost is live resizing, so the terminal is fixed to the size negotiated at connect time.

`terminal.ts` is still written against a small `PtyLike` interface, because that is what makes `bridge()` testable with a fake instead of a subprocess, and it is the seam a later phase would use if resizing ever becomes worth a native dependency. It is not a fork in the road for Phase 1.

**A fixed-size terminal is an acceptable Phase 1 answer, and arguably the right one** — the exam gives you the console you are given. Do not spend time trying to work around a missing compiler.

- [ ] **Step 2: Write the failing test for the disclosure content**

`test/disclosure/content.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { commandSketch, rungContent, type RungContext } from '../../src/engine/disclosure/content.ts'
import type { TaskSpec } from '../../src/engine/content/task.ts'

const SOLUTION = `#!/usr/bin/env bash
# a comment
set -euo pipefail
sudo lvextend -L 12G /dev/rhel/home
sudo xfs_growfs /home

uuid=$(sudo blkid -s UUID -o value /dev/mapper/rhel-home)
sudo sed -i '/home/d' /etc/fstab
printf 'UUID=%s /home xfs defaults 0 0\\n' "$uuid" | sudo tee -a /etc/fstab >/dev/null
sudo systemctl daemon-reload
`

const HEREDOC = `#!/usr/bin/env bash
set -euo pipefail
sudo tee /etc/systemd/system/x.service >/dev/null <<'EOF'
[Unit]
Description=nope
ExecStart=/bin/true
EOF
sudo systemctl daemon-reload
`

function ctx(over: Partial<RungContext> = {}): RungContext {
  const task = {
    id: 'storage/014-grow-home-lv',
    title: 'Grow /home to 12 GiB',
    prompt: 'Grow the home logical volume to 12 GiB.',
    objectives: ['storage.lvm.resize'],
    requiresConcepts: ['storage.lvm-abstraction-stack'],
  } as unknown as TaskSpec

  return {
    task,
    objectives: [{ id: 'storage.lvm.resize', text: 'Extend existing logical volumes', chapters: [15] }],
    concepts: [
      {
        id: 'storage.lvm-abstraction-stack',
        title: 'Physical volumes, volume groups, logical volumes',
        body: 'LVM puts two layers between a disk and a filesystem.',
      } as never,
    ],
    solution: SOLUTION,
    ...over,
  }
}

describe('commandSketch', () => {
  it('lists the commands in order, once each, with no arguments', () => {
    expect(commandSketch(SOLUTION)).toEqual([
      'lvextend',
      'xfs_growfs',
      'blkid',
      'sed',
      'printf',
      'tee',
      'systemctl',
    ])
  })

  it('drops the shebang, comments and set -e', () => {
    const s = commandSketch(SOLUTION)
    expect(s).not.toContain('set')
    expect(s).not.toContain('#!/usr/bin/env')
    expect(s).not.toContain('bash')
  })

  it('does not mistake heredoc bodies for commands', () => {
    // Without heredoc tracking this returns things like '[Unit]' and
    // 'Description=nope', which would be a nonsense hint.
    expect(commandSketch(HEREDOC)).toEqual(['tee', 'systemctl'])
  })
})

describe('rungContent', () => {
  it('rung 1 is the prompt and nothing else', () => {
    const c = rungContent(1, ctx())
    expect(c.kind).toBe('prompt')
    expect(c.body).toBe('Grow the home logical volume to 12 GiB.')
  })

  it('rung 2 names the objective and the concepts without saying how', () => {
    const c = rungContent(2, ctx())
    expect(c.kind).toBe('nudge')
    expect(c.body).toContain('Extend existing logical volumes')
    expect(c.body).toContain('Physical volumes, volume groups, logical volumes')
    // A nudge that contains a command is not a nudge.
    expect(c.body).not.toContain('lvextend')
  })

  it('rung 3 is the full text of every concept card', () => {
    const c = rungContent(3, ctx())
    expect(c.kind).toBe('concepts')
    expect(c.body).toContain('LVM puts two layers between a disk and a filesystem.')
  })

  it('rung 4 lists the commands without their arguments', () => {
    const c = rungContent(4, ctx())
    expect(c.kind).toBe('sketch')
    expect(c.body).toContain('lvextend')
    expect(c.body).toContain('xfs_growfs')
    // The point of a sketch is that it withholds the arguments.
    expect(c.body).not.toContain('12G')
  })

  it('rung 5 is the solution verbatim', () => {
    const c = rungContent(5, ctx())
    expect(c.kind).toBe('solution')
    expect(c.body).toContain('sudo lvextend -L 12G /dev/rhel/home')
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/disclosure/content.test.ts`
Expected: FAIL — cannot resolve `src/engine/disclosure/content.ts`.

- [ ] **Step 4: Implement the disclosure content**

`src/engine/disclosure/content.ts`:

```ts
import type { ConceptSpec } from '../content/concept.ts'
import type { Objective } from '../content/objectives.ts'
import type { TaskSpec } from '../content/task.ts'
import type { Rung } from './ladder.ts'

export type RungKind = 'prompt' | 'nudge' | 'concepts' | 'sketch' | 'solution'

export interface RungContent {
  rung: Rung
  kind: RungKind
  title: string
  body: string
}

export interface RungContext {
  task: TaskSpec
  objectives: Objective[]
  concepts: ConceptSpec[]
  /** The text of the task's first solution. Rungs 4 and 5 are derived from it. */
  solution: string
}

/** Shell words that are never the interesting command on a line. */
const NOISE = new Set([
  'sudo',
  'set',
  'then',
  'else',
  'elif',
  'fi',
  'do',
  'done',
  'if',
  'for',
  'while',
  'exit',
  'return',
  'local',
  'export',
  '[',
  '[[',
  '{',
  '}',
  '(',
  ')',
])

const HEREDOC_START = /<<-?\s*'?"?([A-Za-z_][A-Za-z0-9_]*)'?"?/
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/**
 * The commands a solution runs, in order, once each, stripped of arguments.
 *
 * This is rung 4 of the disclosure ladder. It is derived from the solution
 * rather than authored per task on purpose: a hand-written sketch drifts out of
 * date the moment the solution changes, and nobody notices because no test
 * covers prose.
 */
export function commandSketch(solution: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let heredoc: string | undefined

  for (const raw of solution.split('\n')) {
    const line = raw.trim()

    if (heredoc !== undefined) {
      if (line === heredoc) heredoc = undefined
      continue
    }

    if (line === '' || line.startsWith('#')) continue
    // `set -euo pipefail` is boilerplate, and none of its words is a command.
    if (/^set\s/.test(line)) continue

    const started = HEREDOC_START.exec(line)
    if (started?.[1] !== undefined) heredoc = started[1]

    // Split on everything that can introduce a new command, so a pipeline and
    // a command substitution both contribute.
    for (const seg of line.split(/\$\(|\)|`|\|\||&&|[|;]/)) {
      const words = seg.trim().split(/\s+/).filter((w) => w !== '')
      for (const w of words) {
        // No command name contains a quote, a dollar or a leading dash.
        if (ASSIGNMENT.test(w) || NOISE.has(w) || /^[-'"]/.test(w) || w.includes('$')) continue
        // Only the first real word of a segment is the command.
        const cmd = w.replace(/^.*\//, '')
        if (cmd !== '' && !seen.has(cmd)) {
          seen.add(cmd)
          out.push(cmd)
        }
        break
      }
    }
  }

  return out
}

export function rungContent(rung: Rung, ctx: RungContext): RungContent {
  switch (rung) {
    case 1:
      return { rung, kind: 'prompt', title: 'The task', body: ctx.task.prompt.trim() }

    case 2: {
      const objectives = ctx.objectives.map((o) => `- ${o.text}`).join('\n')
      const concepts = ctx.concepts.map((c) => `- ${c.title}`).join('\n')
      return {
        rung,
        kind: 'nudge',
        title: 'What this is about',
        body:
          `This task is testing:\n${objectives}\n\n` +
          `If you are stuck, one of these is probably the piece you are missing:\n${concepts}`,
      }
    }

    case 3:
      return {
        rung,
        kind: 'concepts',
        title: 'Concept cards',
        body: ctx.concepts.map((c) => `## ${c.title}\n\n${c.body.trim()}`).join('\n\n---\n\n'),
      }

    case 4: {
      const cmds = commandSketch(ctx.solution)
      return {
        rung,
        kind: 'sketch',
        title: 'The commands you need',
        body:
          'In roughly this order, arguments omitted:\n\n' +
          cmds.map((c) => `- \`${c}\``).join('\n') +
          '\n\nEach one has a man page. Read the one you are least sure about.',
      }
    }

    case 5:
      return {
        rung,
        kind: 'solution',
        title: 'A full solution',
        body:
          'One correct answer. It is not the only one, and the grader accepts others.\n\n' +
          '```bash\n' +
          ctx.solution.trim() +
          '\n```',
      }
  }
}
```

- [ ] **Step 5: Run the disclosure tests**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/disclosure/content.test.ts`
Expected: 8 tests PASS.

- [ ] **Step 6: Write the failing test for the session store**

`test/server/session.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  countCheckpoints,
  maxRungFor,
  reportFor,
  SessionStore,
} from '../../src/server/session.ts'
import type { GradeResult } from '../../src/engine/grading/grader.ts'
import { parseVerdict } from '../../src/engine/grading/verdict.ts'

const GRADE = `#!/usr/bin/env bash
# baseline-fail: lv-home-size
set -uo pipefail

lvs --noheadings -o lv_size rhel/home
ck lv-home-size "the home LV is at least 12 GiB" $?

  ck fs-home-size "the filesystem fills it" $? "detail"

# ck not-a-real-one "commented out" $?
exit 0
`

// The shape Task 21's real grader has: no bare `ck` anywhere, and `lv-home-size`
// emitted from both arms of an if/else. Five call sites, three ids. A count of
// call sites would say five and the UI would mask two checkpoints that do not
// exist, so the fixture has to look like the thing being counted.
const GRADE_BRANCHED = `#!/usr/bin/env bash
set -uo pipefail

if within_pct "$\{lv_bytes:-0}" "$TARGET" 2; then
  ck_pass lv-home-size "the home LV is at least 12 GiB"
else
  ck_fail lv-home-size "the home LV is at least 12 GiB" "got $\{lv_bytes:-0} bytes"
fi

ck_pass 'home-from-lv' "/home is mounted from a logical volume"

if [[ -n $\{fs_bytes:-} ]]; then
  ck_pass fs-home-size "the filesystem fills it"
else
  ck_skip fs-home-size "the filesystem fills it" "no filesystem to measure"
fi
`

function result(over: Partial<GradeResult> = {}): GradeResult {
  const verdictA = parseVerdict(
    [
      '{"id":"lv-home-size","desc":"the home LV is at least 12 GiB","status":"pass"}',
      '{"id":"fs-home-size","desc":"the filesystem fills it","status":"fail"}',
    ].join('\n'),
  )
  return { verdictA, regressions: [], rebooted: false, ...over }
}

describe('countCheckpoints', () => {
  it('counts distinct ids and ignores commented-out ones', () => {
    expect(countCheckpoints(GRADE)).toBe(2)
  })

  it('counts an id once however many branches emit it', () => {
    expect(countCheckpoints(GRADE_BRANCHED)).toBe(3)
  })
})

describe('maxRungFor', () => {
  it('gives guided mode the whole ladder', () => {
    // Guided mode is full disclosure by construction, so every rung is open
    // from the start - there is nothing to unlock.
    expect(maxRungFor('guided')).toBe(5)
  })

  it('defers to MAX_RUNG for the graded modes', () => {
    expect(maxRungFor('practice')).toBe(5)
    expect(maxRungFor('drill')).toBe(3)
    expect(maxRungFor('exam')).toBe(2)
  })
})

describe('reportFor', () => {
  it('names the checkpoints in practice mode', () => {
    const r = reportFor('practice', result(), false)
    expect(r.total).toBe(2)
    expect(r.passed).toBe(1)
    expect(r.allPassed).toBe(false)
    expect(r.checkpoints?.map((c) => c.id)).toEqual(['lv-home-size', 'fs-home-size'])
  })

  it('withholds the checkpoints in exam mode until they are revealed', () => {
    const hidden = reportFor('exam', result(), false)
    expect(hidden.passed).toBe(1)
    expect(hidden.total).toBe(2)
    expect(hidden.checkpoints).toBeUndefined()
    expect(hidden.regressions).toBeUndefined()

    const shown = reportFor('exam', result(), true)
    expect(shown.checkpoints).toHaveLength(2)
  })

  it('scores the post-reboot verdict, not the pre-reboot one', () => {
    // The whole point of verdict B: what survives is what counts.
    const verdictB = parseVerdict(
      [
        '{"id":"lv-home-size","desc":"x","status":"pass"}',
        '{"id":"fs-home-size","desc":"y","status":"pass"}',
      ].join('\n'),
    )
    const r = reportFor('practice', result({ verdictB, rebooted: true }), false)
    expect(r.passed).toBe(2)
    expect(r.allPassed).toBe(true)
    expect(r.rebooted).toBe(true)
  })

  it('counts regressions and only names them when revealed', () => {
    const regressed = result({
      rebooted: true,
      verdictB: parseVerdict('{"id":"lv-home-size","desc":"x","status":"fail"}'),
      regressions: [{ id: 'lv-home-size', desc: 'x', status: 'fail' }],
    })
    expect(reportFor('drill', regressed, false).regressionCount).toBe(1)
    expect(reportFor('drill', regressed, false).regressions).toBeUndefined()
    expect(reportFor('drill', regressed, true).regressions).toEqual(['lv-home-size'])
  })

  it('surfaces a reboot that never came back', () => {
    const r = reportFor('practice', result({ rebooted: false, rebootError: 'timed out' }), false)
    expect(r.rebootError).toBe('timed out')
  })
})

describe('SessionStore', () => {
  it('issues sequential ids and starts every session at rung 1', () => {
    const s = new SessionStore()
    const a = s.create('storage/014-grow-home-lv', 'practice', 5, 1000)
    const b = s.create('users/006-team-provisioning', 'exam', 6, 1001)

    expect(a.id).toBe('s1')
    expect(b.id).toBe('s2')
    expect(a.rung).toBe(1)
    expect(a.phase).toBe('active')
    expect(a.checkpointTotal).toBe(5)
    expect(a.startedAt).toBe(1000)
    expect(s.list().map((x) => x.id)).toEqual(['s1', 's2'])
  })

  it('advances the rung up to the mode cap and then refuses', () => {
    const s = new SessionStore()
    const a = s.create('t', 'exam', 3, 0)
    expect(s.advanceRung(a.id).rung).toBe(2)
    expect(() => s.advanceRung(a.id)).toThrow(/maximum in exam mode/)
  })

  it('keeps the attempt active while grading and stores the latest result', () => {
    const s = new SessionStore()
    const a = s.create('t', 'practice', 2, 1000)
    s.record(a.id, result())

    expect(s.get(a.id)?.result).toBeDefined()
    // Grading is repeatable: it must not end the attempt, or masking in exam
    // mode would be pointless.
    expect(s.get(a.id)?.phase).toBe('active')
  })

  it('ends the attempt on finish and keeps the last result', () => {
    const s = new SessionStore()
    const a = s.create('t', 'practice', 2, 1000)
    s.record(a.id, result())
    const done = s.finish(a.id, 4000)

    expect(done.phase).toBe('graded')
    expect(done.endedAt).toBe(4000)
    expect(done.result).toBeDefined()
    // The record in the store is the same one, not a detached copy.
    expect(s.get(a.id)?.phase).toBe('graded')
  })

  it('throws for an unknown id rather than returning a half-built session', () => {
    const s = new SessionStore()
    expect(() => s.advanceRung('nope')).toThrow(/unknown session: nope/)
    expect(s.get('nope')).toBeUndefined()
  })
})
```

- [ ] **Step 7: Run it and watch it fail**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/server/session.test.ts`
Expected: FAIL — cannot resolve `src/server/session.ts`.

- [ ] **Step 8: Implement the session store**

`src/server/session.ts`:

```ts
import { advance, MAX_RUNG, type LadderMode, type Rung } from '../engine/disclosure/ladder.ts'
import { finalVerdict, type GradeResult } from '../engine/grading/grader.ts'
import { allPassed, type CheckpointStatus } from '../engine/grading/verdict.ts'

export type SessionMode = 'guided' | LadderMode
export type SessionPhase = 'active' | 'graded'

export interface SessionRecord {
  id: string
  taskId: string
  mode: SessionMode
  rung: Rung
  /** Number of checkpoints the grader will emit, known before grading. */
  checkpointTotal: number
  startedAt: number
  endedAt?: number
  phase: SessionPhase
  result?: GradeResult
}

/**
 * Every checkpoint id a grader can emit, found without running it. Graders emit
 * through `ck`, `ck_pass`, `ck_fail` or `ck_skip`, and a single checkpoint is
 * routinely emitted from several branches of an if/else — so this counts
 * distinct ids, not call sites. Task 22's authoring rule is what makes it
 * possible: every id is a literal, never a variable.
 */
const CK_CALL = /^[ \t]*ck(?:_pass|_fail|_skip)?[ \t]+["']?([a-z0-9][a-z0-9-]*)/gm

export function countCheckpoints(gradeScript: string): number {
  return new Set([...gradeScript.matchAll(CK_CALL)].map(m => m[1])).size
}

export function maxRungFor(mode: SessionMode): Rung {
  // Guided mode has no ladder to climb: everything is open from the start.
  return mode === 'guided' ? 5 : MAX_RUNG[mode]
}

/** Whether a mode names its checkpoints as soon as it grades. */
function namesCheckpoints(mode: SessionMode): boolean {
  return mode === 'guided' || mode === 'practice'
}

export interface MaskedCheckpoint {
  id: string
  desc: string
  status: CheckpointStatus
}

export interface GradeReport {
  passed: number
  total: number
  allPassed: boolean
  rebooted: boolean
  rebootError?: string
  regressionCount: number
  checkpoints?: MaskedCheckpoint[]
  regressions?: string[]
}

/**
 * `revealed` is for after the attempt is over: drill and exam mode hide which
 * checkpoints failed while the student can still act on it, because "two of six
 * failed" is the question and "which two" is the answer.
 */
export function reportFor(
  mode: SessionMode,
  result: GradeResult,
  revealed: boolean,
): GradeReport {
  // finalVerdict returns verdict B when there was one: what survives is what
  // counts.
  const v = finalVerdict(result)
  const report: GradeReport = {
    passed: v.checkpoints.filter((c) => c.status === 'pass').length,
    total: v.checkpoints.length,
    allPassed: allPassed(v),
    rebooted: result.rebooted,
    regressionCount: result.regressions.length,
  }
  if (result.rebootError !== undefined) report.rebootError = result.rebootError

  if (namesCheckpoints(mode) || revealed) {
    report.checkpoints = v.checkpoints.map((c) => ({
      id: c.id,
      desc: c.desc,
      status: c.status,
    }))
    report.regressions = result.regressions.map((c) => c.id)
  }

  return report
}

export class SessionStore {
  #byId = new Map<string, SessionRecord>()
  #seq = 0

  create(taskId: string, mode: SessionMode, checkpointTotal: number, now: number): SessionRecord {
    this.#seq += 1
    const record: SessionRecord = {
      id: `s${this.#seq}`,
      taskId,
      mode,
      rung: 1,
      checkpointTotal,
      startedAt: now,
      phase: 'active',
    }
    this.#byId.set(record.id, record)
    return record
  }

  get(id: string): SessionRecord | undefined {
    return this.#byId.get(id)
  }

  list(): SessionRecord[] {
    return [...this.#byId.values()]
  }

  #require(id: string): SessionRecord {
    const s = this.#byId.get(id)
    if (s === undefined) throw new Error(`unknown session: ${id}`)
    return s
  }

  advanceRung(id: string): SessionRecord {
    const s = this.#require(id)
    if (s.mode === 'guided') {
      // Nothing to unlock; report the top so the caller can render everything.
      s.rung = 5
      return s
    }
    s.rung = advance({ mode: s.mode, rung: s.rung }).rung
    return s
  }

  /**
   * Put the clock back to zero after the VM has been reverted. Everything else
   * about the attempt survives, the rung most of all: see the `/reset` route.
   */
  restart(id: string, now: number): SessionRecord {
    const s = this.#require(id)
    s.startedAt = now
    return s
  }

  /**
   * Store a grading result without ending the attempt. The student may grade as
   * often as they like; in drill and exam mode the report they get back is
   * masked, so grading is not a way to discover the answer.
   */
  record(id: string, result: GradeResult): SessionRecord {
    const s = this.#require(id)
    s.result = result
    return s
  }

  /** End the attempt. This is what unmasks the checkpoint names. */
  finish(id: string, now: number): SessionRecord {
    const s = this.#require(id)
    s.phase = 'graded'
    s.endedAt = now
    return s
  }
}
```

- [ ] **Step 9: Run the session tests**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/server/session.test.ts`
Expected: 14 tests PASS (13 plus the branched-grader count from Step 8).

- [ ] **Step 10: Write the lab runtime**

`src/server/lab.ts` is the seam between the HTTP layer and the hypervisor. It exists so `app.ts` can be tested with no VM.

```ts
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
```

- [ ] **Step 11: Write the failing test for the API**

`test/server/app.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/server/app.ts'
import { SessionStore } from '../../src/server/session.ts'
import type { LabRuntime } from '../../src/server/lab.ts'
import type { Bank } from '../../src/engine/content/bank.ts'
import type { TaskSpec } from '../../src/engine/content/task.ts'
import type { ConceptSpec } from '../../src/engine/content/concept.ts'
import type { TaskScripts } from '../../src/engine/validate/harness.ts'
import { parseVerdict } from '../../src/engine/grading/verdict.ts'

const TASK = {
  id: 'storage/014-grow-home-lv',
  title: 'Grow /home to 12 GiB',
  chapter: 15,
  scope: 'exam-objective',
  rhel: 9,
  objectives: ['storage.lvm.resize'],
  requiresConcepts: ['storage.lvm-abstraction-stack'],
  difficulty: 3,
  timeBudget: 600,
  weight: 'high',
  editions: ['r9'],
  rebootCheck: true,
  requiresDisks: 0,
  claims: [],
  transport: 'ssh',
  prompt: 'Grow the home logical volume to 12 GiB.',
  dir: '/content/tasks/storage/014-grow-home-lv',
} satisfies TaskSpec

const CONCEPT = {
  id: 'storage.lvm-abstraction-stack',
  title: 'Physical volumes, volume groups, logical volumes',
  rhel: 9,
  objectives: ['storage.lvm.resize'],
  sources: ['r9:ch15'],
  prerequisites: [],
  body: 'LVM puts two layers between a disk and a filesystem.',
  path: '/content/concepts/storage/lvm-abstraction-stack.md',
} satisfies ConceptSpec

const SCRIPTS: TaskScripts = {
  setup: 'echo setup',
  grade: '# baseline-fail: lv-home-size\nck lv-home-size "d" $?\nck fs-home-size "e" $?\n',
  fixtures: [
    { kind: 'solution', name: '01.sh', script: 'sudo lvextend -L 12G /dev/rhel/home\n' },
  ],
}

function bank(): Bank {
  const objective = { id: 'storage.lvm.resize', text: 'Extend existing logical volumes', chapters: [15] }
  return {
    root: '/content',
    objectives: {
      version: 'rhel9',
      source: 'test',
      objectives: [objective],
      byId: new Map([[objective.id, objective]]),
    },
    tasks: [TASK],
    concepts: [CONCEPT],
    tasksById: new Map([[TASK.id, TASK]]),
    conceptsById: new Map([[CONCEPT.id, CONCEPT]]),
  }
}

function runtime(over: Partial<LabRuntime> = {}) {
  const calls: string[] = []
  const rt: LabRuntime = {
    transportKind: 'ssh',
    reset: async () => {
      calls.push('reset')
    },
    exec: async (script) => {
      calls.push(`exec:${script.trim()}`)
      return { stdout: '', stderr: '', code: 0 }
    },
    gradeTask: async () => {
      calls.push('grade')
      return {
        verdictA: parseVerdict(
          [
            '{"id":"lv-home-size","desc":"d","status":"pass"}',
            '{"id":"fs-home-size","desc":"e","status":"fail"}',
          ].join('\n'),
        ),
        regressions: [],
        rebooted: false,
      }
    },
    ...over,
  }
  return { rt, calls }
}

function app(over: Partial<LabRuntime> = {}) {
  const { rt, calls } = runtime(over)
  let clock = 1000
  const sessions = new SessionStore()
  const a = createApp({
    bank: bank(),
    runtime: rt,
    sessions,
    assertLib: '',
    loadScripts: async () => SCRIPTS,
    now: () => (clock += 1000),
  })
  return { a, calls, sessions }
}

describe('GET /api/tasks', () => {
  it('lists tasks without the prompt', async () => {
    const { a } = app()
    const res = await a.request('/api/tasks')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0].id).toBe('storage/014-grow-home-lv')
    // The list is for choosing; the prompt belongs to a session.
    expect(body.tasks[0].prompt).toBeUndefined()
  })
})

describe('GET /api/tasks/:area/:slug', () => {
  it('returns the detail for an id containing a slash', async () => {
    const { a } = app()
    const res = await a.request('/api/tasks/storage/014-grow-home-lv')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.title).toBe('Grow /home to 12 GiB')
    expect(body.objectives[0].text).toBe('Extend existing logical volumes')
  })

  it('404s for an unknown task', async () => {
    const { a } = app()
    const res = await a.request('/api/tasks/storage/nope')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/sessions', () => {
  it('reverts the snapshot, runs setup, and returns a masked checkpoint total', async () => {
    const { a, calls } = app()
    const res = await a.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ taskId: TASK.id, mode: 'exam' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe('s1')
    expect(body.prompt).toContain('Grow the home logical volume')
    expect(body.checkpointTotal).toBe(2)
    expect(body.rung).toBe(1)
    expect(body.maxRung).toBe(2)
    expect(body.transport).toBe('ssh')
    // Order matters: a setup that runs before the revert is undone by it.
    expect(calls).toEqual(['reset', 'exec:echo setup'])
  })

  it('rejects an unknown mode', async () => {
    const { a } = app()
    const res = await a.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ taskId: TASK.id, mode: 'sudden-death' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/mode/)
  })

  it('500s with the setup output when setup fails', async () => {
    // A failed setup produces a cascade of misleading checkpoint failures, so
    // it must never look like a successful start.
    const { a } = app({
      exec: async () => ({ stdout: '', stderr: 'no free extents', code: 1 }),
    })
    const res = await a.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ taskId: TASK.id, mode: 'practice' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/no free extents/)
  })
})

describe('POST /api/sessions/:id/hint', () => {
  async function start(a: ReturnType<typeof app>['a'], mode: string) {
    const res = await a.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ taskId: TASK.id, mode }),
      headers: { 'content-type': 'application/json' },
    })
    return (await res.json()).id as string
  }

  it('walks up the ladder one rung at a time', async () => {
    const { a } = app()
    const id = await start(a, 'practice')

    const first = await (await a.request(`/api/sessions/${id}/hint`, { method: 'POST' })).json()
    expect(first.rung).toBe(2)
    expect(first.content.kind).toBe('nudge')

    const second = await (await a.request(`/api/sessions/${id}/hint`, { method: 'POST' })).json()
    expect(second.rung).toBe(3)
    expect(second.content.body).toContain('LVM puts two layers')
  })

  it('refuses to go past the mode cap', async () => {
    const { a } = app()
    const id = await start(a, 'exam')
    await a.request(`/api/sessions/${id}/hint`, { method: 'POST' })
    const res = await a.request(`/api/sessions/${id}/hint`, { method: 'POST' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/maximum in exam mode/)
  })

  it('gives guided mode everything at once', async () => {
    const { a } = app()
    const id = await start(a, 'guided')
    const res = await a.request(`/api/sessions/${id}/hint`, { method: 'POST' })
    const body = await res.json()
    expect(body.rung).toBe(5)
    // Guided mode is full disclosure, so every rung comes back, not just the top.
    expect(body.all.map((r: { kind: string }) => r.kind)).toEqual([
      'prompt',
      'nudge',
      'concepts',
      'sketch',
      'solution',
    ])
  })
})

describe('POST /api/sessions/:id/reset', () => {
  async function start(a: ReturnType<typeof app>['a'], mode: string) {
    const res = await a.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ taskId: TASK.id, mode }),
      headers: { 'content-type': 'application/json' },
    })
    return (await res.json()).id as string
  }

  it('reverts, re-runs setup, restarts the clock and keeps the rung', async () => {
    const { a, calls } = app()
    const id = await start(a, 'practice')
    await a.request(`/api/sessions/${id}/hint`, { method: 'POST' })
    const before = await (await a.request(`/api/sessions/${id}`)).json()

    const res = await a.request(`/api/sessions/${id}/reset`, { method: 'POST' })
    expect(res.status).toBe(200)
    const after = await res.json()

    expect(calls).toEqual(['reset', 'exec:echo setup', 'reset', 'exec:echo setup'])
    // The clock restarts and nothing else does. A reset that also rolled the
    // rung back would make hints refundable.
    expect(after.startedAt).toBeGreaterThan(before.startedAt)
    expect(after.rung).toBe(2)
    expect(after.phase).toBe('active')
  })

  it('404s for an unknown session', async () => {
    const { a } = app()
    const res = await a.request('/api/sessions/nope/reset', { method: 'POST' })
    expect(res.status).toBe(404)
  })
})

describe('grading and finishing', () => {
  async function start(a: ReturnType<typeof app>['a'], mode: string) {
    const res = await a.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ taskId: TASK.id, mode }),
      headers: { 'content-type': 'application/json' },
    })
    return (await res.json()).id as string
  }

  it('masks which checkpoints failed in exam mode and unmasks them on finish', async () => {
    const { a } = app()
    const id = await start(a, 'exam')

    const graded = await (await a.request(`/api/sessions/${id}/grade`, { method: 'POST' })).json()
    expect(graded.passed).toBe(1)
    expect(graded.total).toBe(2)
    expect(graded.checkpoints).toBeUndefined()
    expect(graded.phase).toBe('active')

    const done = await (await a.request(`/api/sessions/${id}/finish`, { method: 'POST' })).json()
    expect(done.phase).toBe('graded')
    expect(done.report.checkpoints.map((c: { id: string }) => c.id)).toEqual([
      'lv-home-size',
      'fs-home-size',
    ])
    // rung 1, partial pass, no regression: deriveRating calls that 'hard'.
    expect(done.rating).toBe('hard')
  })

  it('names the checkpoints immediately in practice mode', async () => {
    const { a } = app()
    const id = await start(a, 'practice')
    const graded = await (await a.request(`/api/sessions/${id}/grade`, { method: 'POST' })).json()
    expect(graded.checkpoints.map((c: { id: string }) => c.id)).toEqual([
      'lv-home-size',
      'fs-home-size',
    ])
  })

  it('409s on finish before anything was graded', async () => {
    const { a } = app()
    const id = await start(a, 'practice')
    const res = await a.request(`/api/sessions/${id}/finish`, { method: 'POST' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/nothing has been graded/)
  })
})

describe('GET /api/concepts/:id', () => {
  it('returns the card body', async () => {
    const { a } = app()
    const res = await a.request('/api/concepts/storage.lvm-abstraction-stack')
    expect(res.status).toBe(200)
    expect((await res.json()).body).toContain('LVM puts two layers')
  })
})
```

- [ ] **Step 12: Run it and watch it fail**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/server/app.test.ts`
Expected: FAIL — cannot resolve `src/server/app.ts`.

- [ ] **Step 13: Implement the API**

`src/server/app.ts`:

```ts
import { Hono } from 'hono'
import type { Bank } from '../engine/content/bank.ts'
import type { TaskSpec } from '../engine/content/task.ts'
import { rungContent, type RungContent, type RungContext } from '../engine/disclosure/content.ts'
import { deriveRating, type Rating, type Rung } from '../engine/disclosure/ladder.ts'
import type { GradeResult } from '../engine/grading/grader.ts'
import type { TaskScripts } from '../engine/validate/harness.ts'
import type { LabRuntime } from './lab.ts'
import {
  countCheckpoints,
  maxRungFor,
  reportFor,
  SessionStore,
  type SessionMode,
  type SessionRecord,
} from './session.ts'

export interface AppDeps {
  bank: Bank
  runtime: LabRuntime
  sessions: SessionStore
  assertLib: string
  loadScripts: (task: TaskSpec, assertLib: string) => Promise<TaskScripts>
  /** Injected so tests get a deterministic clock. */
  now: () => number
}

const MODES = new Set<string>(['guided', 'practice', 'drill', 'exam'])

function summary(t: TaskSpec) {
  return {
    id: t.id,
    title: t.title,
    chapter: t.chapter,
    scope: t.scope,
    difficulty: t.difficulty,
    timeBudget: t.timeBudget,
    weight: t.weight,
    rebootCheck: t.rebootCheck,
    transport: t.transport,
    objectives: t.objectives,
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function createApp(deps: AppDeps) {
  const app = new Hono()

  /** Everything a rung needs: the task, its objectives, its cards, one solution. */
  async function contextFor(task: TaskSpec): Promise<RungContext> {
    const scripts = await deps.loadScripts(task, deps.assertLib)
    const solution = scripts.fixtures.find((f) => f.kind === 'solution')?.script ?? ''
    return {
      task,
      objectives: task.objectives
        .map((id) => deps.bank.objectives.byId.get(id))
        .filter((o) => o !== undefined),
      concepts: task.requiresConcepts
        .map((id) => deps.bank.conceptsById.get(id))
        .filter((c) => c !== undefined),
      solution,
    }
  }

  app.get('/api/health', (c) =>
    c.json({ ok: true, transport: deps.runtime.transportKind, tasks: deps.bank.tasks.length }),
  )

  app.get('/api/tasks', (c) => c.json({ tasks: deps.bank.tasks.map(summary) }))

  // Task ids contain a slash, so they arrive as two path segments.
  app.get('/api/tasks/:area/:slug', async (c) => {
    const id = `${c.req.param('area')}/${c.req.param('slug')}`
    const task = deps.bank.tasksById.get(id)
    if (task === undefined) return c.json({ error: `unknown task: ${id}` }, 404)

    return c.json({
      ...summary(task),
      objectives: task.objectives.map(
        (oid) => deps.bank.objectives.byId.get(oid) ?? { id: oid, text: oid, chapters: [] },
      ),
      concepts: task.requiresConcepts.map((cid) => ({
        id: cid,
        title: deps.bank.conceptsById.get(cid)?.title ?? cid,
      })),
    })
  })

  app.get('/api/concepts/:id', (c) => {
    const concept = deps.bank.conceptsById.get(c.req.param('id'))
    if (concept === undefined) return c.json({ error: 'unknown concept' }, 404)
    return c.json({
      id: concept.id,
      title: concept.title,
      body: concept.body,
      sources: concept.sources,
      prerequisites: concept.prerequisites,
    })
  })

  app.post('/api/sessions', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { taskId?: string; mode?: string }
    const task = body.taskId === undefined ? undefined : deps.bank.tasksById.get(body.taskId)
    if (task === undefined) return c.json({ error: `unknown task: ${body.taskId}` }, 400)
    if (body.mode === undefined || !MODES.has(body.mode)) {
      return c.json({ error: `mode must be one of guided, practice, drill, exam` }, 400)
    }
    const mode = body.mode as SessionMode

    let scripts: TaskScripts
    try {
      scripts = await deps.loadScripts(task, deps.assertLib)
    } catch (e) {
      return c.json({ error: message(e) }, 500)
    }

    try {
      // Revert first. Running setup before the revert means the revert throws
      // the setup away, and the student gets an untouched machine with a prompt
      // that assumes otherwise.
      await deps.runtime.reset()
      const r = await deps.runtime.exec(scripts.setup)
      if (r.code !== 0) {
        return c.json({ error: `setup.sh exited ${r.code}: ${r.stderr || r.stdout}` }, 500)
      }
    } catch (e) {
      return c.json({ error: message(e) }, 500)
    }

    const s = deps.sessions.create(task.id, mode, countCheckpoints(scripts.grade), deps.now())
    return c.json(
      {
        id: s.id,
        taskId: task.id,
        title: task.title,
        prompt: task.prompt.trim(),
        mode,
        rung: s.rung,
        maxRung: maxRungFor(mode),
        checkpointTotal: s.checkpointTotal,
        timeBudget: task.timeBudget,
        rebootCheck: task.rebootCheck,
        transport: deps.runtime.transportKind,
      },
      201,
    )
  })

  app.get('/api/sessions/:id', (c) => {
    const s = deps.sessions.get(c.req.param('id'))
    if (s === undefined) return c.json({ error: 'unknown session' }, 404)
    return c.json(view(s))
  })

  app.post('/api/sessions/:id/reset', async (c) => {
    const s = deps.sessions.get(c.req.param('id'))
    if (s === undefined) return c.json({ error: 'unknown session' }, 404)
    const task = deps.bank.tasksById.get(s.taskId)
    if (task === undefined) return c.json({ error: `unknown task: ${s.taskId}` }, 500)

    try {
      const scripts = await deps.loadScripts(task, deps.assertLib)
      // Revert then setup, in that order and for the same reason as session
      // creation: setup written before the revert is thrown away by it.
      await deps.runtime.reset()
      const r = await deps.runtime.exec(scripts.setup)
      if (r.code !== 0) {
        return c.json({ error: `setup.sh exited ${r.code}: ${r.stderr || r.stdout}` }, 500)
      }
    } catch (e) {
      return c.json({ error: message(e) }, 500)
    }

    // The rung is deliberately not rolled back. Disclosure already spent stays
    // spent - otherwise reset is a way to launder hints, and the rating derived
    // at finish stops describing the attempt that actually happened. What resets
    // is the machine and the clock.
    deps.sessions.restart(s.id, deps.now())
    return c.json(view(s))
  })

  app.post('/api/sessions/:id/hint', async (c) => {
    const s = deps.sessions.get(c.req.param('id'))
    if (s === undefined) return c.json({ error: 'unknown session' }, 404)
    const task = deps.bank.tasksById.get(s.taskId)
    if (task === undefined) return c.json({ error: `unknown task: ${s.taskId}` }, 500)

    try {
      deps.sessions.advanceRung(s.id)
    } catch (e) {
      // canAdvance said no. 409 rather than 400: the request is well formed,
      // the session just has nothing left to give.
      return c.json({ error: message(e) }, 409)
    }

    const ctx = await contextFor(task)
    if (s.mode === 'guided') {
      const all: RungContent[] = ([1, 2, 3, 4, 5] as Rung[]).map((r) => rungContent(r, ctx))
      return c.json({ rung: s.rung, content: all[all.length - 1], all })
    }
    return c.json({ rung: s.rung, content: rungContent(s.rung, ctx) })
  })

  app.post('/api/sessions/:id/grade', async (c) => {
    const s = deps.sessions.get(c.req.param('id'))
    if (s === undefined) return c.json({ error: 'unknown session' }, 404)
    const task = deps.bank.tasksById.get(s.taskId)
    if (task === undefined) return c.json({ error: `unknown task: ${s.taskId}` }, 500)

    let result: GradeResult
    try {
      const scripts = await deps.loadScripts(task, deps.assertLib)
      result = await deps.runtime.gradeTask(task, scripts.grade)
    } catch (e) {
      return c.json({ error: message(e) }, 500)
    }

    deps.sessions.record(s.id, result)
    // revealed: false - grading is repeatable, so in drill and exam mode this
    // must not turn into a way to read the answer key.
    return c.json({ phase: s.phase, rung: s.rung, ...reportFor(s.mode, result, false) })
  })

  app.post('/api/sessions/:id/finish', (c) => {
    const s = deps.sessions.get(c.req.param('id'))
    if (s === undefined) return c.json({ error: 'unknown session' }, 404)
    const result = s.result
    if (result === undefined) {
      return c.json({ error: 'nothing has been graded yet' }, 409)
    }

    const now = deps.now()
    deps.sessions.finish(s.id, now)
    const task = deps.bank.tasksById.get(s.taskId)
    const report = reportFor(s.mode, result, true)

    let rating: Rating | null = null
    if (s.mode !== 'guided') {
      rating = deriveRating({
        rungUsed: s.rung,
        passed: report.allPassed,
        anyPassed: report.passed > 0,
        durationS: Math.round((now - s.startedAt) / 1000),
        timeBudgetS: task?.timeBudget ?? 600,
        hadRegression: report.regressionCount > 0,
      })
    }

    return c.json({ ...view(s), report, rating })
  })

  return app
}

function view(s: SessionRecord) {
  return {
    id: s.id,
    taskId: s.taskId,
    mode: s.mode,
    rung: s.rung,
    maxRung: maxRungFor(s.mode),
    checkpointTotal: s.checkpointTotal,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    phase: s.phase,
  }
}
```

- [ ] **Step 14: Run the API tests**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/server/app.test.ts`
Expected: 15 tests PASS (13 plus the two for `/reset`).

Note for the executor: `hono`'s `app.request()` is a real fetch round-trip through the router, so these tests exercise routing, JSON parsing and status codes — not just the handler bodies. There is no need for a listening socket.

- [ ] **Step 15: Write the failing test for the terminal bridge**

Only the message plumbing is tested. Spawning a real `ssh` is what Step 20's acceptance covers.

`test/server/terminal.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { bridge, type PtyLike } from '../../src/server/terminal.ts'

function fakePty() {
  const written: string[] = []
  const resized: Array<[number, number]> = []
  let onData: (d: string) => void = () => {}
  let onExit: (code: number) => void = () => {}
  const pty: PtyLike = {
    write: (d) => written.push(d),
    resize: (cols, rows) => resized.push([cols, rows]),
    kill: () => onExit(0),
    onData: (cb) => {
      onData = cb
    },
    onExit: (cb) => {
      onExit = cb
    },
  }
  return { pty, written, resized, emit: (d: string) => onData(d), exit: (c: number) => onExit(c) }
}

function fakeSocket() {
  const sent: string[] = []
  let closed = false
  return {
    sent,
    get closed() {
      return closed
    },
    send: (d: string) => sent.push(d),
    close: () => {
      closed = true
    },
  }
}

describe('bridge', () => {
  it('forwards guest output to the socket', () => {
    const { pty, emit } = fakePty()
    const sock = fakeSocket()
    bridge(pty, sock)
    emit('[student@rhcsa ~]$ ')
    expect(sock.sent).toEqual(['[student@rhcsa ~]$ '])
  })

  it('forwards typed input to the guest', () => {
    const { pty, written } = fakePty()
    const sock = fakeSocket()
    const b = bridge(pty, sock)
    b.onMessage(JSON.stringify({ type: 'input', data: 'lsblk\r' }))
    expect(written).toEqual(['lsblk\r'])
  })

  it('forwards a resize', () => {
    const { pty, resized } = fakePty()
    const b = bridge(pty, fakeSocket())
    b.onMessage(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }))
    expect(resized).toEqual([[120, 40]])
  })

  it('ignores malformed frames instead of killing the session', () => {
    // A dropped keystroke is annoying. A terminal that dies mid-task loses work.
    const { pty, written } = fakePty()
    const b = bridge(pty, fakeSocket())
    b.onMessage('not json')
    b.onMessage(JSON.stringify({ type: 'nonsense' }))
    expect(written).toEqual([])
  })

  it('closes the socket when the shell exits', () => {
    const { pty, exit } = fakePty()
    const sock = fakeSocket()
    bridge(pty, sock)
    exit(0)
    expect(sock.closed).toBe(true)
  })

  it('kills the shell when the socket closes', () => {
    const { pty } = fakePty()
    const sock = fakeSocket()
    let killed = false
    const b = bridge({ ...pty, kill: () => (killed = true) }, sock)
    b.onClose()
    expect(killed).toBe(true)
  })
})
```

- [ ] **Step 16: Run it and watch it fail**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/server/terminal.test.ts`
Expected: FAIL — cannot resolve `src/server/terminal.ts`.

- [ ] **Step 17: Implement the terminal bridge**

`src/server/terminal.ts`:

```ts
import { spawn } from 'node:child_process'
import type { Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { sshArgs, type VmConfig } from '../engine/vm/config.ts'

/**
 * The minimum a pseudo-terminal has to do. `spawnSshPipe` is the one
 * implementation — a plain pipe to `ssh -tt`, no native dependency, which
 * matters because this environment cannot install a compiler. The interface
 * exists so `bridge` can be tested against a fake instead of a subprocess.
 */
export interface PtyLike {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(cb: (data: string) => void): void
  onExit(cb: (code: number) => void): void
}

export interface SocketLike {
  send(data: string): void
  close(): void
}

export interface Bridge {
  onMessage(raw: string): void
  onClose(): void
}

/**
 * Wire a terminal to a socket. Pure plumbing, no I/O of its own, which is why
 * every branch is testable without a guest.
 */
export function bridge(pty: PtyLike, socket: SocketLike): Bridge {
  pty.onData((d) => socket.send(d))
  pty.onExit(() => socket.close())

  return {
    onMessage(raw) {
      let msg: unknown
      try {
        msg = JSON.parse(raw)
      } catch {
        // A malformed frame is not worth ending a lab session over.
        return
      }
      if (typeof msg !== 'object' || msg === null) return
      const m = msg as { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown }

      if (m.type === 'input' && typeof m.data === 'string') pty.write(m.data)
      else if (m.type === 'resize' && typeof m.cols === 'number' && typeof m.rows === 'number') {
        pty.resize(m.cols, m.rows)
      }
    },
    onClose() {
      pty.kill()
    },
  }
}

/**
 * A terminal over a plain pipe to `ssh -tt`. `-tt` forces a PTY on the *guest*
 * side, which is what vim, less and nmtui need; the local side does not need one
 * because xterm.js is the terminal. The cost is that resize is a no-op, so the
 * Lab screen fixes the terminal size (see Task 24).
 */
export function spawnSshPipe(cfg: VmConfig, cols: number, rows: number): PtyLike {
  // stty at connect time is the only chance to tell the guest the size.
  const remote = `stty cols ${cols} rows ${rows}; exec /bin/bash -l`
  const child = spawn('ssh', [...sshArgs(cfg), '-tt', remote], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  return {
    write: (d) => void child.stdin.write(d),
    resize: () => {
      // Not possible without a local PTY. Deliberately silent: the client is
      // told the size is fixed when it connects.
    },
    kill: () => void child.kill(),
    onData: (cb) => {
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', cb)
      child.stderr.on('data', cb)
    },
    onExit: (cb) => child.on('exit', (code) => cb(code ?? 0)),
  }
}

export interface TerminalDeps {
  cfg: VmConfig
  /** Injection point for the tests; production always gets `spawnSshPipe`. */
  spawnPty?: (cfg: VmConfig, cols: number, rows: number) => PtyLike
}

/** Attach a WebSocket endpoint at /ws/terminal to an existing HTTP server. */
export function attachTerminal(server: Server, deps: TerminalDeps): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })
  const spawnPty = deps.spawnPty ?? spawnSshPipe

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/ws/terminal') {
      socket.destroy()
      return
    }
    const cols = Number(url.searchParams.get('cols') ?? 100) || 100
    const rows = Number(url.searchParams.get('rows') ?? 30) || 30

    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      const pty = spawnPty(deps.cfg, cols, rows)
      const b = bridge(pty, {
        send: (d) => {
          if (ws.readyState === ws.OPEN) ws.send(d)
        },
        close: () => ws.close(),
      })
      ws.on('message', (data) => b.onMessage(data.toString()))
      ws.on('close', () => b.onClose())
    })
  })

  return wss
}
```

**This needs one small addition to Task 17's `config.ts`:** export the SSH argument list so the terminal and `SshTransport` cannot drift apart.

```ts
/**
 * The pinned ssh options, shared by SshTransport and the terminal bridge. One
 * definition, because a terminal that trusts a different host key than the
 * grader does is a bug nobody would think to look for.
 */
export function sshArgs(cfg: VmConfig): string[] {
  return [
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${join(homedir(), '.ssh', 'rhcsa_known_hosts')}`,
    '-o', 'ConnectTimeout=10',
    '-o', 'LogLevel=ERROR',
    '-i', cfg.sshKey,
    '-p', String(cfg.sshPort),
    `${cfg.sshUser}@${cfg.ip ?? ''}`,
  ]
}
```

Refactor `SshTransport` in `src/engine/vm/ssh.ts` to call `sshArgs(cfg)` and append `'bash -s'`, replacing its inline copy of the option list. Its existing tests assert on the produced argv, so they must keep passing unchanged — if they do not, the two lists had already drifted and the tests are the record of which one was right.

- [ ] **Step 18: Run the terminal tests**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/server/terminal.test.ts test/vm/ssh.test.ts`
Expected: 6 terminal tests PASS, and every existing `ssh.test.ts` test still PASS.

- [ ] **Step 19: Write the server entry point**

`src/server/index.ts`:

```ts
import { serve } from '@hono/node-server'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { loadBank } from '../engine/content/bank.ts'
import { loadTaskScripts } from '../engine/validate/harness.ts'
import { loadVmConfig } from '../engine/vm/config.ts'
import { chooseTransport } from '../engine/vm/select.ts'
import { VmController } from '../engine/vm/vmrun.ts'
import { createApp } from './app.ts'
import { createLabRuntime } from './lab.ts'
import { SessionStore } from './session.ts'
import { attachTerminal } from './terminal.ts'

const PORT = Number(process.env.RHCSA_PORT ?? 5175)
const CONTENT = process.env.RHCSA_CONTENT ?? 'content'
const SNAPSHOT = process.env.RHCSA_SNAPSHOT ?? 'clean'

const cfg = loadVmConfig(process.env)
const bank = await loadBank(CONTENT)
const assertLib = await readFile(join(CONTENT, 'lib', 'assert.sh'), 'utf8')
const transport = await chooseTransport(cfg)
const controller = new VmController(cfg)

const app = createApp({
  bank,
  runtime: createLabRuntime({ transport, controller, snapshot: SNAPSHOT }),
  sessions: new SessionStore(),
  assertLib,
  loadScripts: loadTaskScripts,
  now: () => Date.now(),
})

const server = serve({ fetch: app.fetch, port: PORT }) as unknown as Server
attachTerminal(server, { cfg })

console.log(`rhcsa-trainer api on http://localhost:${PORT} (transport: ${transport.kind})`)
console.log(`  ${bank.tasks.length} tasks, ${bank.concepts.length} concepts`)
```

**One transport for the whole process.** `chooseTransport` runs once at startup with no `require`, so the server prefers SSH and falls back to `vmrun` only if SSH is unreachable. A task declaring `transport: vmrun` cannot force a switch at runtime — Phase 1 grades that one task through `rhcsa validate` instead, and Task 24's Lab screen shows a plain warning when `task.transport` does not match the process transport.

Add to `package.json` scripts:

```json
"dev:server": "node --env-file-if-exists=.env.local src/server/index.ts"
```

`--env-file-if-exists` and not `--env-file`: the server reads `RHCSA_VMX` and `RHCSA_VM_IP` out of `.env.local`, and without the flag they are simply absent and `chooseTransport` picks the fake — a confusing failure. The `-if-exists` form keeps the script working on a checkout that has no `.env.local` yet. There is deliberately no `--watch`; see Task 25's note on the scripts block.

- [ ] **Step 20: ACCEPTANCE — drive the API against the real VM**

```bash
cd /home/daxtangco/rhcsa-trainer
node --env-file-if-exists=.env.local src/server/index.ts &
sleep 3
curl -s localhost:5175/api/health; echo
curl -s localhost:5175/api/tasks | head -c 300; echo
S=$(curl -s -X POST localhost:5175/api/sessions \
  -H 'content-type: application/json' \
  -d '{"taskId":"storage/014-grow-home-lv","mode":"practice"}')
echo "$S"
ID=$(printf '%s' "$S" | sed 's/.*"id":"\([^"]*\)".*/\1/')
curl -s -X POST "localhost:5175/api/sessions/$ID/hint"; echo
curl -s -X POST "localhost:5175/api/sessions/$ID/grade"; echo
```

Expected, in order:
1. `{"ok":true,"transport":"ssh","tasks":5}`
2. a JSON array containing all five task ids
3. the session, with `"checkpointTotal":5` and `"maxRung":5`. **This call reverts the snapshot and runs `setup.sh`, so it takes 10–20 seconds** — that is the snapshot revert, not a hang.
4. the rung-2 nudge, naming the LVM objective and both concept card titles, with no commands in it
5. a grade report showing `lv-home-size` and `fs-home-size` failing, because nothing has been done yet. **`"rebooted":true` and a 60–90 second wait are expected**, since this task sets `reboot_check: true`.

Then check the terminal by hand:

```bash
cd /home/daxtangco/rhcsa-trainer
npx wscat -c 'ws://localhost:5175/ws/terminal?cols=100&rows=30'
# type: {"type":"input","data":"lsblk\r"}
```
Expected: the `lsblk` output comes back as text frames, showing `rhel-home` at the size `setup.sh` left it. Then `kill %1` to stop the server.

If `wscat` is not installed, `npx -y wscat` fetches it. This is the only manual check in the task; everything else is covered by tests.

- [ ] **Step 21: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/server src/engine/disclosure/content.ts src/engine/vm/config.ts src/engine/vm/ssh.ts \
        test/server test/disclosure/content.test.ts package.json package-lock.json && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(server): lab API, disclosure ladder content, terminal bridge

Rungs 4 and 5 are derived from the task's first solution rather than authored
per task. A hand-written command sketch drifts out of date the moment the
solution changes and no test covers prose; a derived one cannot.

Grading is repeatable and masked; finishing is what unmasks. Otherwise 'grade'
becomes a way to read the answer key one checkpoint at a time, and drill and
exam mode stop meaning anything.

The terminal runs over a pipe to ssh -tt rather than a local PTY, so it has no
native dependency - this environment has no compiler and no sudo to install
one. -tt still gives the guest a real terminal, which is what vim and nmtui
need. The cost is a fixed terminal size."
```

---

### Task 24: The Lab screen

**Files:**
- Create: `src/web/api.ts`
- Test: `test/web/api.test.ts`
- Create: `src/web/components/TerminalPane.tsx`
- Create: `src/web/components/Rail.tsx`
- Test: `test/web/rail.test.tsx`
- Create: `src/web/components/TaskPicker.tsx`
- Create: `src/web/App.tsx`
- Create: `src/web/main.tsx`
- Create: `src/web/index.css`
- Create: `index.html`, `vite.config.ts` — neither exists yet; Task 1 scaffolded the Node side only
- Modify: `package.json`, `vitest.config.ts`, `tsconfig.json`

**Interfaces:**
- Consumes: every route from Task 23.
- Produces:
  - `interface TaskSummary`, `interface StartedSession`, `interface SessionView`, `interface GradeReportView`, `interface HintResponse`
  - `class ApiError extends Error { readonly status: number }`
  - `function createApi(fetchImpl?: typeof fetch)` returning `{ tasks, task, concept, start, hint, reset, grade, finish }`
  - `function Rail(props: RailProps)`, `function TerminalPane(props)`, `function TaskPicker(props)`, `function App()`

**Layout.** Prompt on top, terminal filling the middle, a fixed rail down the right side. The prompt is always visible because the single most common self-inflicted failure in a practical exam is answering a question you have half-remembered. The rail holds the mode, the timer, the rung, the masked checkpoint count and four buttons — Hint, Grade, Finish, and a Reset that asks first; it never holds a hint's content, which opens over the prompt so it cannot be read out of the corner of your eye while you work.

- [ ] **Step 1: Confirm the frontend dependencies**

Run:
```bash
cd /home/daxtangco/rhcsa-trainer
npm install react react-dom @xterm/xterm
npm install -D vite tailwindcss @vitejs/plugin-react @tailwindcss/vite @types/react @types/react-dom \
  @testing-library/react @testing-library/dom jsdom
npx vite --version
```

Task 1 installed none of this — it scaffolded the Node side only. Installing a dependency twice is harmless, so run the whole line even if some of it is already present.

Add the jsdom environment for the component test only, so the Node-side tests keep running in Node. Replace `vitest.config.ts` with this — it is Task 1's file plus the React plugin, the `.tsx` glob and the jsdom mapping, and it **keeps the `RHCSA_VM` gate** and Task 1's `globals` and `exclude` lines verbatim. Dropping that gate makes `npm test` try to drive a hypervisor; dropping the `globals` flag silently disables Testing Library's DOM cleanup.

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // Registers Vitest's global `afterEach`, which is the only thing that lets
    // @testing-library/react install its automatic DOM cleanup. Without it the
    // component tests of Task 24 accumulate mounted trees and `getByText`
    // starts throwing on duplicate matches. Carried over from Task 1 verbatim.
    globals: true,
    // .tsx joins the glob for the component tests.
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // Both arms restate node_modules and dist, because naming `exclude` at all
    // replaces Vitest's defaults rather than adding to them.
    exclude: process.env.RHCSA_VM === '1' ? ['**/node_modules/**', '**/dist/**'] : ['**/node_modules/**', '**/dist/**', 'test/**/*.vm.test.ts'],
    // jsdom for the component tests only; everything else stays in Node.
    environmentMatchGlobs: [['test/web/**', 'jsdom']],
    testTimeout: 10_000,
  },
})
```

- [ ] **Step 2: Teach `tsc` about the DOM**

This has to happen before the first `.tsx` file is written, or `npm run typecheck` fails on every line of it. In `tsconfig.json`, three `compilerOptions` change — nothing else in the file moves:

```json
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node", "vite/client"],
    "jsx": "react-jsx",
```

`jsx: react-jsx` is what lets a `.tsx` file compile without importing `React` for the sake of the factory. `DOM` and `DOM.Iterable` are what make `document`, `HTMLElement` and iterating a `NodeList` type-check. `vite/client` is the important one and the easiest to miss: **it is what declares `*.css` as a module**, so `import './index.css'` in `main.tsx` type-checks with no ambient declaration of your own. Do not add a `declarations.d.ts` with `declare module '*.css'` — it is the same thing written twice, and the second copy is the one that goes stale.

Task 1 deliberately did not set any of this. A DOM lib and a JSX factory in a project with no `.tsx` files is noise, and `"types": ["vite/client"]` fails outright before vite is installed. This task is the one that makes the settings true, so this task sets them.

- [ ] **Step 3: Write the failing test for the API client**

`test/web/api.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ApiError, createApi } from '../../src/web/api.ts'

function fakeFetch(handler: (url: string, init?: RequestInit) => [number, unknown]) {
  const seen: Array<{ url: string; init?: RequestInit }> = []
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    seen.push({ url, init })
    const [status, body] = handler(url, init)
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { impl, seen }
}

describe('createApi', () => {
  it('lists tasks', async () => {
    const { impl } = fakeFetch(() => [200, { tasks: [{ id: 'storage/014-grow-home-lv' }] }])
    const api = createApi(impl)
    expect(await api.tasks()).toEqual([{ id: 'storage/014-grow-home-lv' }])
  })

  it('starts a session with a JSON body', async () => {
    const { impl, seen } = fakeFetch(() => [201, { id: 's1', rung: 1 }])
    const api = createApi(impl)
    const s = await api.start('storage/014-grow-home-lv', 'practice')

    expect(s.id).toBe('s1')
    expect(seen[0]?.url).toBe('/api/sessions')
    expect(seen[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({
      taskId: 'storage/014-grow-home-lv',
      mode: 'practice',
    })
  })

  it('splits a task id across path segments without encoding the slash', async () => {
    // encodeURIComponent would turn the slash into %2F and the route would 404.
    const { impl, seen } = fakeFetch(() => [200, { id: 'x' }])
    await createApi(impl).task('storage/014-grow-home-lv')
    expect(seen[0]?.url).toBe('/api/tasks/storage/014-grow-home-lv')
  })

  it('throws ApiError carrying the status and the server message', async () => {
    const { impl } = fakeFetch(() => [409, { error: 'rung 2 is the maximum in exam mode' }])
    const api = createApi(impl)
    await expect(api.hint('s1')).rejects.toThrow(/maximum in exam mode/)
    await expect(api.hint('s1')).rejects.toBeInstanceOf(ApiError)
  })

  it('reports a non-JSON failure without pretending it parsed', async () => {
    const impl = (async () => new Response('<html>502</html>', { status: 502 })) as unknown as typeof fetch
    await expect(createApi(impl).tasks()).rejects.toThrow(/502/)
  })
})
```

- [ ] **Step 4: Run it and watch it fail**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/web/api.test.ts`
Expected: FAIL — cannot resolve `src/web/api.ts`.

- [ ] **Step 5: Implement the API client**

`src/web/api.ts`:

```ts
export interface TaskSummary {
  id: string
  title: string
  chapter: number
  scope: 'exam-objective' | 'instrumental'
  difficulty: number
  timeBudget: number
  weight: 'low' | 'medium' | 'high'
  rebootCheck: boolean
  transport: 'ssh' | 'vmrun'
  objectives: string[]
}

export type SessionMode = 'guided' | 'practice' | 'drill' | 'exam'

export interface StartedSession {
  id: string
  taskId: string
  title: string
  prompt: string
  mode: SessionMode
  rung: number
  maxRung: number
  checkpointTotal: number
  timeBudget: number
  rebootCheck: boolean
  transport: 'ssh' | 'vmrun'
}

/**
 * What the session routes hand back: the record itself, without the task fields
 * that only `POST /api/sessions` bothers to inline. `/reset` returns this.
 */
export interface SessionView {
  id: string
  taskId: string
  mode: SessionMode
  rung: number
  maxRung: number
  checkpointTotal: number
  startedAt: number
  endedAt?: number
  phase: string
}

export interface CheckpointView {
  id: string
  desc: string
  status: 'pass' | 'fail' | 'skip'
}

export interface GradeReportView {
  passed: number
  total: number
  allPassed: boolean
  rebooted: boolean
  rebootError?: string
  regressionCount: number
  checkpoints?: CheckpointView[]
  regressions?: string[]
  phase?: string
}

export interface RungContentView {
  rung: number
  kind: 'prompt' | 'nudge' | 'concepts' | 'sketch' | 'solution'
  title: string
  body: string
}

export interface HintResponse {
  rung: number
  content: RungContentView
  all?: RungContentView[]
}

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function createApi(fetchImpl: typeof fetch = fetch) {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchImpl(path, init)
    const text = await res.text()

    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      // An HTML error page from a proxy is the usual cause. Say so plainly
      // rather than throwing a JSON parse error nobody can act on.
      throw new ApiError(res.status, `${res.status} ${res.statusText}: ${text.slice(0, 120)}`)
    }

    if (!res.ok) {
      const msg = (body as { error?: string }).error ?? `${res.status} ${res.statusText}`
      throw new ApiError(res.status, msg)
    }
    return body as T
  }

  function post<T>(path: string, body?: unknown): Promise<T> {
    return call<T>(path, {
      method: 'POST',
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
  }

  return {
    async tasks(): Promise<TaskSummary[]> {
      return (await call<{ tasks: TaskSummary[] }>('/api/tasks')).tasks
    },
    // The id already contains the slash the route needs, so it must not be
    // percent-encoded.
    task: (id: string) => call<unknown>(`/api/tasks/${id}`),
    concept: (id: string) => call<{ id: string; title: string; body: string }>(`/api/concepts/${id}`),
    start: (taskId: string, mode: SessionMode) =>
      post<StartedSession>('/api/sessions', { taskId, mode }),
    hint: (id: string) => post<HintResponse>(`/api/sessions/${id}/hint`),
    // Returns the session, not a report: the machine and the clock go back, the
    // rung does not.
    reset: (id: string) => post<SessionView>(`/api/sessions/${id}/reset`),
    grade: (id: string) => post<GradeReportView>(`/api/sessions/${id}/grade`),
    finish: (id: string) =>
      post<{ phase: string; report: GradeReportView; rating: string | null }>(
        `/api/sessions/${id}/finish`,
      ),
  }
}
```

- [ ] **Step 6: Run the API client tests**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/web/api.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 7: Write the failing test for the rail**

`test/web/rail.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Rail } from '../../src/web/components/Rail.tsx'
import type { GradeReportView, StartedSession } from '../../src/web/api.ts'

function session(over: Partial<StartedSession> = {}): StartedSession {
  return {
    id: 's1',
    taskId: 'storage/014-grow-home-lv',
    title: 'Grow /home to 12 GiB',
    prompt: 'Grow it.',
    mode: 'exam',
    rung: 1,
    maxRung: 2,
    checkpointTotal: 5,
    timeBudget: 600,
    rebootCheck: true,
    transport: 'ssh',
    ...over,
  }
}

function noop() {}

const props = {
  elapsedS: 90,
  onHint: noop,
  onGrade: noop,
  onFinish: noop,
  onReset: noop,
}

describe('Rail', () => {
  it('shows how many checkpoints there are without naming them', () => {
    render(<Rail {...props} session={session()} rung={1} />)
    expect(screen.getByText('5 checkpoints')).toBeDefined()
    expect(screen.queryByText(/lv-home-size/)).toBeNull()
  })

  it('shows the elapsed time against the budget', () => {
    render(<Rail {...props} session={session()} rung={1} elapsedS={90} />)
    expect(screen.getByText('01:30 / 10:00')).toBeDefined()
  })

  it('says so when the time budget is blown', () => {
    render(<Rail {...props} session={session()} rung={1} elapsedS={900} />)
    expect(screen.getByText(/over budget/i)).toBeDefined()
  })

  it('disables the hint button at the mode cap and says why', () => {
    render(<Rail {...props} session={session()} rung={2} />)
    const hint = screen.getByRole('button', { name: /hint/i })
    expect(hint.getAttribute('disabled')).not.toBeNull()
    expect(screen.getByText(/no more hints in exam mode/i)).toBeDefined()
  })

  it('names the checkpoints when the report names them', () => {
    const report: GradeReportView = {
      passed: 1,
      total: 2,
      allPassed: false,
      rebooted: true,
      regressionCount: 0,
      checkpoints: [
        { id: 'lv-home-size', desc: 'the home LV is at least 12 GiB', status: 'pass' },
        { id: 'fs-home-size', desc: 'the filesystem fills it', status: 'fail' },
      ],
    }
    render(<Rail {...props} session={session({ mode: 'practice' })} rung={1} report={report} />)
    expect(screen.getByText('the filesystem fills it')).toBeDefined()
  })

  it('shows only the tally when the report masks the checkpoints', () => {
    const report: GradeReportView = {
      passed: 3,
      total: 5,
      allPassed: false,
      rebooted: true,
      regressionCount: 0,
    }
    render(<Rail {...props} session={session()} rung={1} report={report} />)
    expect(screen.getByText('3 / 5 passed')).toBeDefined()
    expect(screen.getByText(/which ones is not shown/i)).toBeDefined()
  })

  it('calls out a persistence failure in words, not a number', () => {
    // This is the single most valuable output in the whole app, so it does not
    // get to be a subtle badge.
    const report: GradeReportView = {
      passed: 4,
      total: 5,
      allPassed: false,
      rebooted: true,
      regressionCount: 1,
    }
    render(<Rail {...props} session={session()} rung={1} report={report} />)
    expect(screen.getByText(/passed before the reboot and failed after it/i)).toBeDefined()
  })

  it('surfaces a guest that never came back', () => {
    const report: GradeReportView = {
      passed: 0,
      total: 5,
      allPassed: false,
      rebooted: false,
      rebootError: 'guest did not come back within 120000ms',
      regressionCount: 0,
    }
    render(<Rail {...props} session={session()} rung={1} report={report} />)
    expect(screen.getByText(/did not come back/i)).toBeDefined()
  })

  it('calls onGrade when the grade button is pressed', () => {
    const onGrade = vi.fn()
    render(<Rail {...props} session={session()} rung={1} onGrade={onGrade} />)
    screen.getByRole('button', { name: /grade/i }).click()
    expect(onGrade).toHaveBeenCalledOnce()
  })

  it('asks before resetting, and does nothing if the answer is no', () => {
    const onReset = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Rail {...props} session={session()} rung={1} onReset={onReset} />)
    screen.getByRole('button', { name: /reset lab/i }).click()
    expect(confirm).toHaveBeenCalledOnce()
    expect(onReset).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    screen.getByRole('button', { name: /reset lab/i }).click()
    expect(onReset).toHaveBeenCalledOnce()
    confirm.mockRestore()
  })

  it('warns when the task needs a transport the server is not using', () => {
    render(
      <Rail
        {...props}
        session={session({ transport: 'vmrun' })}
        serverTransport="ssh"
        rung={1}
      />,
    )
    expect(screen.getByText(/needs the vmrun transport/i)).toBeDefined()
  })
})
```

- [ ] **Step 8: Run it and watch it fail**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/web/rail.test.tsx`
Expected: FAIL — cannot resolve `src/web/components/Rail.tsx`.

- [ ] **Step 9: Implement the rail**

`src/web/components/Rail.tsx`:

```tsx
import type { GradeReportView, StartedSession } from '../api.ts'

export interface RailProps {
  session: StartedSession
  rung: number
  elapsedS: number
  report?: GradeReportView
  busy?: 'hinting' | 'grading' | 'finishing' | 'reverting' | null
  error?: string | null
  serverTransport?: 'ssh' | 'vmrun'
  onHint: () => void
  onGrade: () => void
  onFinish: () => void
  onReset: () => void
}

function mmss(total: number): string {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const DOT: Record<string, string> = {
  pass: 'text-emerald-400',
  fail: 'text-rose-400',
  skip: 'text-zinc-500',
}

export function Rail(props: RailProps) {
  const { session, rung, elapsedS, report, busy } = props
  const overBudget = elapsedS > session.timeBudget
  const atCap = rung >= session.maxRung
  // Both null and undefined mean "not working". `busy !== null` alone would
  // treat an omitted prop as busy and disable every button.
  const working = busy !== undefined && busy !== null
  const mismatch =
    props.serverTransport !== undefined && props.serverTransport !== session.transport

  return (
    <aside className="w-72 shrink-0 border-l border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-300 flex flex-col gap-4">
      <div>
        <div className="uppercase tracking-wide text-xs text-zinc-500">mode</div>
        <div className="text-zinc-100">{session.mode}</div>
      </div>

      <div>
        <div className="uppercase tracking-wide text-xs text-zinc-500">time</div>
        <div className={overBudget ? 'text-amber-400' : 'text-zinc-100'}>
          {mmss(elapsedS)} / {mmss(session.timeBudget)}
        </div>
        {overBudget ? <div className="text-xs text-amber-400">over budget</div> : null}
      </div>

      <div>
        <div className="uppercase tracking-wide text-xs text-zinc-500">disclosure</div>
        <div className="text-zinc-100">
          rung {rung} of {session.maxRung}
        </div>
        {atCap ? (
          <div className="text-xs text-zinc-500">no more hints in {session.mode} mode</div>
        ) : null}
      </div>

      <div>
        <div className="uppercase tracking-wide text-xs text-zinc-500">checkpoints</div>
        {report === undefined ? (
          <div className="text-zinc-100">{session.checkpointTotal} checkpoints</div>
        ) : (
          <>
            <div className="text-zinc-100">
              {report.passed} / {report.total} passed
            </div>
            {report.checkpoints === undefined ? (
              <div className="text-xs text-zinc-500">which ones is not shown in this mode</div>
            ) : (
              <ul className="mt-2 space-y-1">
                {report.checkpoints.map((c) => (
                  <li key={c.id} className="flex gap-2">
                    <span className={DOT[c.status] ?? 'text-zinc-500'}>&#9679;</span>
                    <span className="text-xs">{c.desc}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {report !== undefined && report.regressionCount > 0 ? (
        <div className="rounded border border-rose-800 bg-rose-950/40 p-2 text-xs text-rose-200">
          {report.regressionCount === 1 ? '1 checkpoint' : `${report.regressionCount} checkpoints`}{' '}
          passed before the reboot and failed after it. That is a persistence failure: the change
          was never written anywhere that survives a restart.
        </div>
      ) : null}

      {report?.rebootError !== undefined ? (
        <div className="rounded border border-amber-800 bg-amber-950/40 p-2 text-xs text-amber-200">
          The reboot check could not run: {report.rebootError}
        </div>
      ) : null}

      {mismatch ? (
        <div className="rounded border border-amber-800 bg-amber-950/40 p-2 text-xs text-amber-200">
          This task needs the vmrun transport and the server is using{' '}
          {props.serverTransport}. Work at the VMware console and grade it with
          <code className="mx-1">rhcsa validate</code>.
        </div>
      ) : null}

      {props.error !== null && props.error !== undefined ? (
        <div className="rounded border border-rose-800 bg-rose-950/40 p-2 text-xs text-rose-200">
          {props.error}
        </div>
      ) : null}

      <div className="mt-auto flex flex-col gap-2">
        <button
          type="button"
          onClick={props.onHint}
          disabled={atCap || working}
          className="rounded bg-zinc-800 px-3 py-2 text-zinc-100 disabled:opacity-40"
        >
          {busy === 'hinting' ? 'opening...' : 'Hint (F2)'}
        </button>
        <button
          type="button"
          onClick={props.onGrade}
          disabled={working}
          className="rounded bg-emerald-700 px-3 py-2 text-white disabled:opacity-40"
        >
          {busy === 'grading' ? 'grading...' : 'Grade (F4)'}
        </button>
        <button
          type="button"
          onClick={props.onFinish}
          disabled={report === undefined || working}
          className="rounded bg-zinc-800 px-3 py-2 text-zinc-100 disabled:opacity-40"
        >
          Finish (F8)
        </button>
        <button
          type="button"
          // Destructive and irreversible, so it asks. No keyboard shortcut
          // either: a function key that throws away twenty minutes of work is a
          // trap, and this is the one control that should cost a deliberate
          // click.
          onClick={() => {
            if (window.confirm('Reset the lab? This reverts the VM and restarts the timer.')) {
              props.onReset()
            }
          }}
          disabled={working}
          className="rounded border border-zinc-700 px-3 py-2 text-zinc-400 disabled:opacity-40"
        >
          {busy === 'reverting' ? 'reverting...' : 'Reset lab'}
        </button>
      </div>
    </aside>
  )
}
```

**The Reset button confirms, and it does not move the rung.** Reverting the VM throws away everything the student has typed, so a misplaced click has to be recoverable — hence `window.confirm`. What it does *not* undo is disclosure: the hints already opened stay open and `rung` stays where it was, because a reset that refunded them would turn the ladder into a free lookup and make the rating derived at finish describe an attempt that never happened. The wording says what it does in the terms the student cares about: the machine goes back, the clock goes back.

One consequence to expect rather than debug: the terminal dies with the revert. The shell is an ssh session into a machine whose disk has just been rolled back underneath it, so `TerminalPane` will show its closed state and the page needs a reload to get a prompt again. Reconnecting the WebSocket on demand is Phase 2 work; a button that reverts the VM is still worth far more than the reload it costs.

Note the `working` guard. `busy` and `error` are optional, so an omitted `busy` arrives as `undefined`, and `undefined !== null` is `true` — comparing against `null` alone would disable every button for every caller that does not pass the prop, including the test's `props` object.

- [ ] **Step 10: Run the rail tests**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/web/rail.test.tsx`
Expected: 11 tests PASS.

If the *hint* button is unexpectedly disabled in the first test, either the `working` guard is comparing against `null` alone, or `atCap` is reading `props.session.rung` (which the fixture sets to 1 regardless) instead of `props.rung`.

- [ ] **Step 11: Write the terminal pane**

`src/web/components/TerminalPane.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

export interface TerminalPaneProps {
  cols?: number
  rows?: number
  onStatus?: (status: 'open' | 'closed' | 'error') => void
}

/**
 * The terminal is a fixed size on purpose. The server side runs `ssh -tt` over a
 * pipe with no local PTY, so there is no way to deliver a window-size change to
 * the guest after the connection is up (see Task 23). A terminal that reflows
 * without the guest agreeing produces a display that lies about where the cursor
 * is, which is worse than one that does not reflow.
 */
export function TerminalPane({ cols = 100, rows = 30, onStatus }: TerminalPaneProps) {
  const host = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const node = host.current
    if (node === null) return

    const term = new Terminal({
      cols,
      rows,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 14,
      theme: { background: '#09090b', foreground: '#e4e4e7' },
    })
    term.open(node)
    term.focus()

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(
      `${proto}://${window.location.host}/ws/terminal?cols=${cols}&rows=${rows}`,
    )

    ws.onopen = () => onStatus?.('open')
    ws.onerror = () => onStatus?.('error')
    ws.onclose = () => {
      onStatus?.('closed')
      term.write('\r\n\x1b[33m[connection closed]\x1b[0m\r\n')
    }
    ws.onmessage = (ev) => term.write(String(ev.data))

    const sub = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    return () => {
      sub.dispose()
      // `onclose` writes to the terminal, and `ws.close()` fires it. Null it
      // first or the write lands on a terminal that is about to be disposed -
      // in React's strict-mode double-mount that is every unmount.
      ws.onclose = null
      ws.close()
      term.dispose()
    }
  }, [cols, rows, onStatus])

  return <div ref={host} className="p-2" />
}
```

- [ ] **Step 12: Write the task picker**

`src/web/components/TaskPicker.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { SessionMode, TaskSummary } from '../api.ts'

const MODES: Array<{ id: SessionMode; label: string; blurb: string }> = [
  { id: 'guided', label: 'Guided', blurb: 'Everything open. Read the cards, follow along, learn it.' },
  { id: 'practice', label: 'Practice', blurb: 'Hints on request, all five rungs, named checkpoints.' },
  { id: 'drill', label: 'Drill', blurb: 'Concept cards only. No command sketch, no solution.' },
  { id: 'exam', label: 'Exam', blurb: 'One nudge. Scores are masked until you finish.' },
]

export interface TaskPickerProps {
  tasks: TaskSummary[]
  error?: string | null
  busy?: boolean
  onStart: (taskId: string, mode: SessionMode) => void
}

export function TaskPicker({ tasks, error, busy = false, onStart }: TaskPickerProps) {
  const [mode, setMode] = useState<SessionMode>('practice')
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (selected === null && tasks.length > 0) setSelected(tasks[0]?.id ?? null)
  }, [tasks, selected])

  return (
    <div className="mx-auto max-w-3xl p-8 text-zinc-200">
      <h1 className="text-2xl text-zinc-100">RHCSA lab</h1>

      <div className="mt-6 grid grid-cols-2 gap-3">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={`rounded border p-3 text-left ${
              mode === m.id ? 'border-emerald-600 bg-emerald-950/30' : 'border-zinc-800'
            }`}
          >
            <div className="text-zinc-100">{m.label}</div>
            <div className="text-xs text-zinc-400">{m.blurb}</div>
          </button>
        ))}
      </div>

      <ul className="mt-6 divide-y divide-zinc-800 rounded border border-zinc-800">
        {tasks.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => setSelected(t.id)}
              className={`flex w-full items-center gap-3 p-3 text-left ${
                selected === t.id ? 'bg-zinc-900' : ''
              }`}
            >
              <span className="w-10 text-xs text-zinc-500">ch{t.chapter}</span>
              <span className="flex-1 text-zinc-100">{t.title}</span>
              {t.scope === 'instrumental' ? (
                <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                  supporting
                </span>
              ) : null}
              {t.rebootCheck ? (
                <span className="text-xs text-zinc-500">reboot check</span>
              ) : null}
              <span className="text-xs text-zinc-500">{Math.round(t.timeBudget / 60)} min</span>
            </button>
          </li>
        ))}
      </ul>

      {error !== null && error !== undefined ? (
        <div className="mt-4 rounded border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <button
        type="button"
        disabled={selected === null || busy}
        onClick={() => selected !== null && onStart(selected, mode)}
        className="mt-6 rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-40"
      >
        {busy ? 'reverting the snapshot...' : 'Start'}
      </button>
      <p className="mt-2 text-xs text-zinc-500">
        Starting reverts the lab VM to the clean snapshot and runs the task's setup. It takes
        about fifteen seconds and discards anything left over from a previous attempt.
      </p>
    </div>
  )
}
```

- [ ] **Step 13: Write the Lab screen**

`src/web/App.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import {
  createApi,
  type GradeReportView,
  type RungContentView,
  type SessionMode,
  type StartedSession,
  type TaskSummary,
} from './api.ts'
import { Rail } from './components/Rail.tsx'
import { TaskPicker } from './components/TaskPicker.tsx'
import { TerminalPane } from './components/TerminalPane.tsx'

const api = createApi()

type Busy = 'hinting' | 'grading' | 'finishing' | 'reverting' | null

export function App() {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [serverTransport, setServerTransport] = useState<'ssh' | 'vmrun'>()
  const [session, setSession] = useState<StartedSession>()
  const [rung, setRung] = useState(1)
  const [elapsedS, setElapsedS] = useState(0)
  const [report, setReport] = useState<GradeReportView>()
  const [rating, setRating] = useState<string | null>(null)
  const [hint, setHint] = useState<RungContentView[]>([])
  const [busy, setBusy] = useState<Busy>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .tasks()
      .then(setTasks)
      .catch((e: unknown) => setError(String(e)))
    fetch('/api/health')
      .then((r) => r.json())
      .then((h: { transport: 'ssh' | 'vmrun' }) => setServerTransport(h.transport))
      .catch(() => undefined)
  }, [])

  // One timer for the whole session. It counts wall-clock time, including the
  // time spent reading a hint, because the exam clock does too.
  useEffect(() => {
    if (session === undefined) return
    const started = Date.now()
    const t = setInterval(() => setElapsedS(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(t)
  }, [session])

  const start = useCallback(async (taskId: string, mode: SessionMode) => {
    setError(null)
    setStarting(true)
    try {
      const s = await api.start(taskId, mode)
      setSession(s)
      setRung(s.rung)
      setReport(undefined)
      setRating(null)
      setHint([])
      setElapsedS(0)
      if (s.mode === 'guided') {
        // Guided mode is full disclosure: open everything immediately rather
        // than making the student click four times to get to it.
        const h = await api.hint(s.id)
        setRung(h.rung)
        setHint(h.all ?? [h.content])
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }, [])

  const doHint = useCallback(async () => {
    if (session === undefined) return
    setBusy('hinting')
    setError(null)
    try {
      const h = await api.hint(session.id)
      setRung(h.rung)
      setHint(h.all ?? [h.content])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [session])

  const doReset = useCallback(async () => {
    if (session === undefined) return
    setBusy('reverting')
    setError(null)
    try {
      const s = await api.reset(session.id)
      // A fresh object, so the timer effect above re-runs and the clock starts
      // over. The rung comes back from the server unchanged, and the hints
      // already opened stay on screen: disclosure that has been spent is spent.
      setSession({ ...session, rung: s.rung })
      setRung(s.rung)
      setReport(undefined)
      setRating(null)
      setElapsedS(0)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [session])

  const doGrade = useCallback(async () => {
    if (session === undefined) return
    setBusy('grading')
    setError(null)
    try {
      setReport(await api.grade(session.id))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [session])

  const doFinish = useCallback(async () => {
    if (session === undefined) return
    setBusy('finishing')
    try {
      const done = await api.finish(session.id)
      setReport(done.report)
      setRating(done.rating)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [session])

  // F2/F4/F8 rather than control keys: the terminal has to receive every
  // control sequence the shell uses, and ^R, ^H and ^G are all taken.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (session === undefined) return
      if (e.key === 'F2') {
        e.preventDefault()
        void doHint()
      } else if (e.key === 'F4') {
        e.preventDefault()
        void doGrade()
      } else if (e.key === 'F8') {
        e.preventDefault()
        void doFinish()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session, doHint, doGrade, doFinish])

  if (session === undefined) {
    return <TaskPicker tasks={tasks} error={error} busy={starting} onStart={start} />
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-950">
      <header className="border-b border-zinc-800 p-4">
        <div className="text-xs uppercase tracking-wide text-zinc-500">{session.taskId}</div>
        <h1 className="text-lg text-zinc-100">{session.title}</h1>
        <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-zinc-300">
          {session.prompt}
        </pre>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-auto">
          <TerminalPane />
          {hint.length > 0 ? (
            <div className="m-2 rounded border border-zinc-800 bg-zinc-900 p-4">
              {hint.map((h) => (
                <section key={h.rung} className="mb-4">
                  <h2 className="text-sm uppercase tracking-wide text-zinc-500">
                    rung {h.rung} — {h.title}
                  </h2>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-zinc-200">
                    {h.body}
                  </pre>
                </section>
              ))}
            </div>
          ) : null}
          {rating !== null ? (
            <div className="m-2 rounded border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-200">
              Attempt finished. Scheduler rating: <strong>{rating}</strong>. This is derived from
              the grade, the rung you needed and the time you took — nothing here is self-reported.
            </div>
          ) : null}
        </main>

        <Rail
          session={session}
          rung={rung}
          elapsedS={elapsedS}
          report={report}
          busy={busy}
          error={error}
          serverTransport={serverTransport}
          onHint={doHint}
          onGrade={doGrade}
          onFinish={doFinish}
          onReset={doReset}
        />
      </div>
    </div>
  )
}
```

`src/web/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './index.css'

const root = document.getElementById('root')
if (root === null) throw new Error('no #root in index.html')
createRoot(root).render(<App />)
```

`src/web/index.css`:

```css
@import 'tailwindcss';

html,
body,
#root {
  height: 100%;
  background: #09090b;
}
```

`index.html`:

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RHCSA lab</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/web/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 14: Proxy the API and the WebSocket through Vite**

`vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5175',
      // ws: true is the part people forget, and without it the terminal
      // silently never connects in dev.
      '/ws': { target: 'ws://localhost:5175', ws: true },
    },
  },
})
```

Add to `package.json` scripts:

```json
"dev:server": "node --env-file-if-exists=.env.local src/server/index.ts",
"dev:web": "vite",
"build:web": "vite build"
```

**`--env-file-if-exists` is not optional.** `loadVmConfig` reads `RHCSA_VMX` from `process.env`, and that value lives in `.env.local` (Task 15 §6) which nothing has loaded until now. Without the flag the server exits on startup with `RHCSA_VMX is not set` on a machine where the variable is, in fact, set.

There is deliberately no combined `dev` script. Backgrounding the server behind `&` inside npm means Ctrl-C kills the foreground half and orphans the other, and the orphan holds port 5175 — which then looks like a proxy bug. Two terminals.

- [ ] **Step 15: Run every test**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run && npx tsc --noEmit`
Expected: every test in the repo PASSES and `tsc` reports no errors.

`tsc --noEmit` matters more than usual here: the web code is the first part of the project that is never executed by a test in its real form, so type checking is the only thing standing between a typo in `App.tsx` and a blank page.

- [ ] **Step 16: ACCEPTANCE — use it**

Two terminals:

```bash
# terminal 1
cd /home/daxtangco/rhcsa-trainer && npm run dev:server

# terminal 2
cd /home/daxtangco/rhcsa-trainer && npm run dev:web
```

Terminal 1 must print `transport: ssh` before you open the browser. If it prints `RHCSA_VMX is not set`, `.env.local` is missing or `--env-file-if-exists` was left out of the script.

Open `http://localhost:5173`. Check, in order:

1. The picker lists five tasks with chapter numbers, and the SELinux one is tagged `supporting`.
2. Choose **Practice** and `Grow /home to 12 GiB`, press Start. It takes about fifteen seconds, then the prompt appears above a terminal with a live shell.
3. In the terminal, `df -h /home` reports about 8 GiB and nearly full. That is `setup.sh`'s filler file, so the scenario is real rather than described.
4. Press **F2**. The rung-2 nudge appears below the terminal, naming the objective and the two concept cards. It contains no commands.
5. Press **F2** again. Both concept cards appear in full. **This is the exit-criterion moment: everything needed to solve the task is now on screen, and none of it came from a book.**
6. Solve it in the terminal: `sudo lvextend -L 12G /dev/rhel/home` then `sudo xfs_growfs /home`.
7. Press **F4**. Expect a 60–90 second wait for the reboot check, then 5/5 with every checkpoint named and green.
8. Press **F8**. Expect a rating of `hard` — rung 3 was used — and the explanation that the rating was derived, not self-reported.

Then prove the masking works:

9. Reload, choose **Exam** and the same task, press Start, press **F4** immediately. Expect `3 / 5 passed` and `which ones is not shown in this mode`, and no checkpoint names anywhere on screen. Three, not zero: `setup.sh` leaves `/home` on a logical volume, `/var` intact and `/etc/fstab` unedited, so only the two size checkpoints fail before you do anything. A grader that reported `0 / 5` on an untouched machine would be checking the wrong things.
10. Press **F2** twice. The second press is refused with `rung 2 is the maximum in exam mode`.
11. Press **F8**. The checkpoint names appear now, with the rating.

Finally the persistence message, which is the output the whole design exists to produce:

12. Reload, **Practice**, same task. Run `sudo lvextend -L 12G /dev/rhel/home`, `sudo xfs_growfs /home`, then `sudo sed -i '\|[[:space:]]/home[[:space:]]|s|^|#|' /etc/fstab`. Press **F4**.
13. Expect the rail to say *"passed before the reboot and failed after it. That is a persistence failure"*. If it says anything less specific, the wording in `Rail.tsx` was softened — put it back.

And the reset control:

14. Press **Reset lab**. Expect a confirmation naming both consequences, then about fifteen seconds of `reverting...`, then a timer back at `00:00` and `df -h /home` reporting 8 GiB again. The rung stays where it was and any hint already open stays open. The terminal will have dropped — reload the page for a new shell.

- [ ] **Step 17: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/web test/web index.html vite.config.ts vitest.config.ts tsconfig.json package.json package-lock.json && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(web): Lab screen - prompt on top, terminal, rail

The prompt stays on screen for the whole attempt. Answering a half-remembered
question is the most common self-inflicted failure in a practical exam, and it
costs nothing to prevent.

Hints open below the terminal rather than in the rail, so a solution cannot be
read out of the corner of your eye while you are still trying.

F2/F4/F8 rather than control keys: the terminal must receive every control
sequence the shell uses, and ^G, ^H and ^R are all taken by bash.

The terminal is a fixed 100x30. The server has no local PTY, so a window-size
change cannot reach the guest, and a pane that reflows without the guest
agreeing draws the cursor in the wrong place."
```

---

### Task 25: The end-to-end exit criterion

Phase 1 ends when this sentence is true:

> The user completes a real graded LVM lab end to end including the reboot check, having learned the concept from a concept card rather than a book.

Every earlier task built a piece of that sentence. This task proves the sentence, twice: once mechanically, so a regression three months from now is caught by `npm test` rather than by a bad exam; and once by hand, because "learned the concept" is not something a test can assert.

**Files:**
- Create: `test/vm/e2e-exit-criterion.vm.test.ts`
- Create: `docs/exit-criterion.md`
- Create: `docs/coverage-phase-1.md`
- Modify: `README.md`
- Modify: `package.json` (add the `test:vm` and `coverage` scripts)

**Interfaces:**
- Consumes: `createApp` / `AppDeps` (T23), `createLabRuntime` (T23), `SessionStore` (T23), `loadBank` (T7), `loadTaskScripts` (T11), `loadVmConfig` / `chooseTransport` (T18), `VmController` (T17).
- Produces: nothing new in code. The deliverable is a passing gate and two documents.

**Why the automated half drives the API and not the browser.** A browser test would need a headless Chromium, a running Vite dev server, a running API server and a VM, and it would fail for four reasons that all look the same. The Lab screen's own logic is already covered by `test/web/rail.test.tsx` and `test/web/api.test.ts` against fakes. What is *not* covered anywhere is the whole spine — bank → session → guest → grader → verdict A → reboot → verdict B → rating — running against a real RHEL 9 machine. That spine is what the exit criterion is about, and it lives entirely behind `createApp`. Driving `app.request()` against a real transport tests it with no browser in the picture. The last mile, "and the human could see it and use it", is Step 8's manual run.

- [ ] **Step 1: Add the two npm scripts**

In `package.json`, the `scripts` block becomes:

```json
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:vm": "[ -f .env.local ] && { set -a; . ./.env.local; set +a; }; RHCSA_VM=1 vitest run .vm.test.ts",
    "typecheck": "tsc --noEmit",
    "rhcsa": "node --env-file-if-exists=.env.local src/cli/index.ts",
    "validate": "node --env-file-if-exists=.env.local src/cli/index.ts validate",
    "coverage": "node src/cli/index.ts coverage",
    "dev:server": "node --env-file-if-exists=.env.local src/server/index.ts",
    "dev:web": "vite",
    "build:web": "vite build"
  },
```

`dev:server`, `dev:web` and `build:web` came from Task 24; leave them as they are. Four notes on the rest:

- **`validate` and `rhcsa` carry `--env-file-if-exists=.env.local`.** Every VM-touching entrypoint needs `RHCSA_VMX`, and until this task the flag was typed by hand on each acceptance step. Wrapping it in a script is the difference between a command that works in three months and one that fails with `RHCSA_VMX is not set` on a machine where the variable is set.
- **`coverage` deliberately does not.** It reads the content bank and nothing else; giving it VM config would imply it needs a VM.
- **`test:vm` sources `.env.local` in the shell instead**, because Vitest is not Node's CLI and `--env-file-if-exists` does not reach it. `set -a` exports every assignment in the file, which is the same trick `provision.sh` uses. The `[ -f .env.local ] &&` guard is the shell's equivalent of `-if-exists`: a bare `. ./.env.local` under a shell that stops on error aborts the whole script on a checkout that has no `.env.local`, so the suite would fail before it could report the far more useful "RHCSA_VMX is not set". The trailing `.vm.test.ts` is a Vitest filename filter, and it is the only way a `*.vm.test.ts` suite ever runs — the default `npm test` excludes them.
- **No `--watch` on `dev:server`.** A restart drops the WebSocket terminal and the in-memory session store mid-lab — the student's shell dies and their rung and elapsed time go with it, which is a worse outcome than typing the command again. Restart the server by hand.

**The suffix, not the directory, is what gates.** `test/vm/config.test.ts`, `vmrun.test.ts`, `ssh.test.ts` and `select.test.ts` all drive the transports through fakes and must keep running in `npm test`; only `e2e-exit-criterion.vm.test.ts` needs a hypervisor.

- [ ] **Step 2: Write the end-to-end test**

`test/vm/e2e-exit-criterion.vm.test.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadBank } from '../../src/engine/content/bank.ts'
import { loadTaskScripts } from '../../src/engine/validate/harness.ts'
import { chooseTransport } from '../../src/engine/vm/select.ts'
import { loadVmConfig } from '../../src/engine/vm/config.ts'
import { VmController } from '../../src/engine/vm/vmrun.ts'
import { createApp } from '../../src/server/app.ts'
import { createLabRuntime } from '../../src/server/lab.ts'
import type { LabRuntime } from '../../src/server/lab.ts'
import { SessionStore } from '../../src/server/session.ts'

const TASK_ID = 'storage/014-grow-home-lv'
const CONTENT = process.env.RHCSA_CONTENT ?? 'content'
const SNAPSHOT = process.env.RHCSA_SNAPSHOT ?? 'clean'

/** The whole point: the reboot is real, so the budget is real. */
const E2E_TIMEOUT = 300_000

/**
 * Wait until the guest will actually accept a command, not merely until vmrun
 * says it is up. `waitForGuest` polls through the guest *tools*, which answer
 * seconds before sshd is listening — so the first exec after a revert or a
 * reboot can fail on connection refused, and over HTTP that arrives as a bare
 * 500 with nothing in it to diagnose. Thirty attempts two seconds apart is a
 * minute of slack against a boot that normally takes far less.
 */
async function waitForSsh(runtime: LabRuntime): Promise<void> {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const r = await runtime.exec('true')
      if (r.code === 0) return
    } catch {
      // sshd is not listening yet; that is what we are waiting for.
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('guest tools answered but sshd never accepted a connection (30 attempts, 2s apart)')
}

async function buildApp() {
  const cfg = loadVmConfig(process.env)
  const bank = await loadBank(CONTENT)
  const assertLib = await readFile(join(CONTENT, 'lib', 'assert.sh'), 'utf8')
  const transport = await chooseTransport(cfg)
  const controller = new VmController(cfg)
  // The runtime is returned as well as injected: the test has to reach the
  // guest to apply the solution, and building a second transport of its own
  // would mean a second SSH identity and a second set of host keys to get
  // wrong. One connection, used by both the app and the test.
  const runtime = createLabRuntime({ transport, controller, snapshot: SNAPSHOT })
  // grade() execs verdict B the instant reboot() resolves, and reboot() resolves
  // on guest-tools readiness. Bolt the sshd wait onto this one instance rather
  // than changing Task 17's contract for the callers that grade over vmrun and
  // genuinely do not care.
  const rebooted = controller.reboot.bind(controller)
  controller.reboot = async () => {
    await rebooted()
    await waitForSsh(runtime)
  }
  const app = createApp({
    bank,
    runtime,
    sessions: new SessionStore(),
    assertLib,
    loadScripts: loadTaskScripts,
    now: () => Date.now(),
  })
  return { app, bank, assertLib, runtime, transportKind: transport.kind }
}

type App = Awaited<ReturnType<typeof buildApp>>['app']

async function json(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`status ${res.status}, body was not JSON: ${text.slice(0, 200)}`)
  }
}

function post(app: App, path: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
}

describe('phase 1 exit criterion', () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    ctx = await buildApp()
    // The guest may have been powered on moments ago; the session-create call
    // below reverts a snapshot and immediately runs setup.sh over the transport.
    await waitForSsh(ctx.runtime)
  }, 120_000)

  it(
    'teaches the concept, grades the solution and survives the reboot',
    async () => {
      const { app, bank, assertLib } = ctx

      // --- the lab exists and its prompt is real -------------------------
      const started = await json(await post(app, '/api/sessions', {
        taskId: TASK_ID,
        mode: 'practice',
      }))
      expect(started.error).toBeUndefined()
      const id = started.id as string
      expect(started.checkpointTotal).toBe(5)
      expect(String(started.prompt)).toMatch(/12/)

      // --- "learned the concept from a concept card" ----------------------
      // Rung 2 names the objective and the cards but must not contain the
      // command. If it does, the ladder has collapsed into an answer key.
      const nudge = await json(await post(app, `/api/sessions/${id}/hint`))
      expect(nudge.rung).toBe(2)
      const nudgeBody = String((nudge.content as Record<string, unknown>).body)
      expect(nudgeBody).not.toMatch(/lvextend|xfs_growfs/)

      // Rung 3 is the cards themselves, in full. This is the surface that
      // replaces the book, so an empty or stub card fails the criterion.
      const cards = await json(await post(app, `/api/sessions/${id}/hint`))
      expect(cards.rung).toBe(3)
      const cardBody = String((cards.content as Record<string, unknown>).body)
      expect(cardBody).toMatch(/physical volume/i)
      expect(cardBody).toMatch(/xfs_growfs/)
      expect(cardBody.length).toBeGreaterThan(1500)

      // --- solve it the way a student would, in the guest -----------------
      const task = bank.tasksById.get(TASK_ID)
      if (task === undefined) throw new Error(`missing task ${TASK_ID}`)
      const scripts = await loadTaskScripts(task, assertLib)
      const solution = scripts.fixtures.find((f) => f.kind === 'solution')
      if (solution === undefined) throw new Error('no solution fixture')
      const run = await ctx.runtime.exec(solution.script)
      expect(run.code, run.stderr).toBe(0)

      // --- grade: verdict A, reboot, verdict B ----------------------------
      const report = await json(await post(app, `/api/sessions/${id}/grade`))
      expect(report.error).toBeUndefined()
      expect(report.rebootError).toBeUndefined()
      expect(report.rebooted).toBe(true)
      expect(report.regressionCount).toBe(0)
      expect(report.passed).toBe(5)
      expect(report.total).toBe(5)
      expect(report.allPassed).toBe(true)

      // --- finish: the rating is derived, not asked for --------------------
      const done = await json(await post(app, `/api/sessions/${id}/finish`))
      // 'graded' is the terminal phase in SessionPhase; there is no 'done'.
      expect(done.phase).toBe('graded')
      // Three rungs used on a fully passing attempt.
      expect(done.rating).toBe('hard')
      const finalReport = done.report as Record<string, unknown>
      expect(Array.isArray(finalReport.checkpoints)).toBe(true)
    },
    E2E_TIMEOUT,
  )
})
```

**Note the ordering.** The solution runs *after* the two hint calls, not before. That is not decoration: `advanceRung` refuses past the cap, and `reportFor` names checkpoints only at rung 3 or above in practice mode, so grading first would test a different code path than the one a student uses.

**Note what is not asserted.** The test never inspects `/home` itself. `grade.sh` is the thing that decides whether the task was done, and a test that checks the filesystem independently would be a second grader — one that can disagree with the real one and be right for the wrong reason.

- [ ] **Step 3: Run it against the real VM**

Run:
```bash
cd /home/daxtangco/rhcsa-trainer
npm run test:vm
```

Expected: one test, PASS, in roughly two to three minutes — about 15 s for the revert and setup, a few seconds for the solution, then 60–90 s for the reboot.

If it fails, the assertion that failed says which half of the spine broke:

| Failing assertion | What it means | Where to look |
|---|---|---|
| `started.error` defined | revert or `setup.sh` failed | the error text is `setup.sh`'s stderr; run it by hand with `rhcsa validate` |
| `checkpointTotal` is not 5 | `countCheckpoints` cannot see a `ck` call | a `ck` id in `grade.sh` is not literal — T22's rule |
| `nudgeBody` matches `lvextend` | the rung-2 text leaks the command | `rungContent` case 2 in `src/engine/disclosure/content.ts` |
| `cardBody.length` too small | a concept card is a stub | `content/concepts/storage/*.md` |
| `run.code` non-zero | the solution script itself broke | its stderr is in the failure message |
| `rebootError` defined | the guest did not come back | R1 territory: re-read `docs/r1-findings.md`, or the transport fell back to `vmrun` |
| `regressionCount` > 0 | verdict A passed and verdict B did not | real persistence bug in the solution, or `/etc/fstab` handling |
| `passed` < 5 | the grader disagrees with the solution | run `npm run validate storage/014-grow-home-lv` for the per-checkpoint detail |
| `rating` is not `hard` | `deriveRating`'s inputs changed | `src/engine/disclosure/ladder.ts`, and check `rungUsed` is 3 |

- [ ] **Step 4: Run the whole bank one more time, in two runs**

The exit criterion is about one task, but shipping a broken sibling is not a thing to discover in month three.

**Two runs, not one.** `npm run validate` with no arguments loads the whole bank, and `require` is derived as `vmrun` if *any* task asks for it — so a single full-bank run would push all thirty fixtures through the slow transport and take most of a day. Split it the way Task 22 did:

```bash
cd /home/daxtangco/rhcsa-trainer

# the four SSH tasks plus the storage one: 24 fixtures, 45-60 minutes
npm run validate -- \
  storage/014-grow-home-lv \
  users/006-team-provisioning \
  selinux/019-httpd-alt-port \
  systemd/017-boot-time-service 2>&1 | tail -40
echo "exit=$?"

# the vmrun task on its own: 6 fixtures, 15-20 minutes
export RHCSA_GUEST_PASSWORD='<the student account password>'
npm run validate -- troubleshooting/028-restore-remote-access 2>&1 | tail -20
echo "exit=$?"
```

Expected: `transport: ssh` and **`24/24 fixtures ok`** from the first run, `transport: vmrun` and **`6/6 fixtures ok`** from the second. Thirty fixtures, `exit=0` both times.

If a fixture fails, fix the content, not the assertion. The failure tables in Task 21 Step 12 and Task 22 Steps 9–10 cover the common causes.

- [ ] **Step 5: Capture the coverage snapshot**

Run:
```bash
cd /home/daxtangco/rhcsa-trainer
npm run coverage > docs/coverage-phase-1.md
```

Then open it and add a heading and three sentences of context at the top, because a bare report loses its meaning in a month:

```markdown
# Coverage at the end of Phase 1

Five tasks and ten concept cards. This is a scaffolding sample, not a
study plan: the objectives it covers were chosen to stress-test the
content conventions across four shapes of question, not to cover the
exam. Phase 2's job is to make the uncovered list short.

<!-- the generated report follows -->
```

Check the numbers before committing: `5 tasks`, `10 concepts`, and an uncovered-objectives list that is long. **A short uncovered list at the end of Phase 1 means the objective taxonomy from Task 13 is incomplete**, not that the content is done — go back and check T13's transcription against the exam objectives page.

- [ ] **Step 6: Write the exit-criterion record**

`docs/exit-criterion.md`:

```markdown
# Phase 1 exit criterion

> The user completes a real graded LVM lab end to end including the reboot
> check, having learned the concept from a concept card rather than a book.

Two halves. The automated half is `test/vm/e2e-exit-criterion.vm.test.ts`,
run with `npm run test:vm`. It proves the spine works: bank, session,
guest, grader, verdict A, reboot, verdict B, rating. It also asserts the
rung-2 nudge does not contain `lvextend` and that the concept cards are
longer than 1500 characters, which is the closest a test can get to
"the card is what taught it".

The manual half is below, and it is the half that matters. Fill in the
dates and the answers the first time you run it, and again whenever the
disclosure ladder or the content conventions change.

## The run

- Date:
- Mode: practice
- Task: `storage/014-grow-home-lv`
- Transport reported at startup:

1. Started the lab. The prompt was on screen the whole time: yes / no
2. `df -h /home` in the terminal showed a nearly full 8 GiB filesystem: yes / no
3. Pressed F2 twice and read both concept cards.
4. **Could you solve the task from the cards alone, with no other reference open?** yes / no
   - If no: what was missing from the cards?
5. Solved it. Commands used:
6. Pressed F4. Reboot check ran: yes / no. Result: __ / 5
7. Pressed F8. Rating:

## The question the whole project turns on

> Was there any moment in that run where you wanted to open the book?

Answer honestly, and write down what you would have looked up. That
sentence is the first item of Phase 2's content backlog — a card that
should exist and does not is a more useful finding than any passing test.

## Known limits at this point

- One task per exam area at most; four areas of eleven have any content.
- FSRS is implemented and rated but nothing schedules from it yet: there
  is no "what should I practice today" screen.
- Sessions live in memory. Restarting the server loses history, so the
  ratings recorded above are not yet stored anywhere.
- The troubleshooting task (`028-restore-remote-access`) is graded through
  `rhcsa validate`, not the Lab screen: the server picks one transport at
  startup and that task needs `vmrun`.
- The terminal is a fixed 100x30 and does not reflow.
- Teaching after a failed attempt is the rung-3 concept cards and nothing
  more. There is no per-task post-mortem written for the case where you got
  it wrong; spec §7.1's second half is Phase 2, and it needs a loader field
  and a slot in the session view before it needs prose.
- The UI shows which transport is live, not the VM's power state. Spec §11
  rule 1 is only partly met; a polled state indicator is Phase 2.
- `weight` is authored and validated but no selection logic reads it — spec
  §14.4 scheduling is Phase 2.
```

Those limits are the Phase 2 backlog stated as facts rather than promises. Do not soften them; a limit you can read is a limit you can plan around.

- [ ] **Step 7: Update the README**

The README from Task 15 covers building the VM. Add a section after it so the project is startable after a three-month gap, when nobody remembers the environment variables.

Append to `README.md`. Six backticks on this block, not three: the README text itself contains fenced shell blocks, and a three-backtick outer fence would end at the first of them instead of at the end of the section.

``````markdown
## Running the trainer

Two processes. The API talks to the VM; Vite serves the UI and proxies to the API.

```bash
# terminal 1 - the API
npm run dev:server

# terminal 2 - the UI
npm run dev:web
```

Then open http://localhost:5173.

The API prints the transport it chose at startup. `ssh` is the normal case.
`vmrun` means SSH could not reach the guest — usable, but slow, and the
terminal pane will not work. Check that the VM is running, then re-read
`docs/r1-findings.md`: a Windows update can undo the change recorded there.

### Environment

These live in `.env.local` at the repo root, which is git-ignored.
`provision.sh` writes `RHCSA_VM_IP` into it for you; the rest come from
`docs/vm-build-checklist.md` section 6.

| Variable | Meaning | Default |
|---|---|---|
| `RHCSA_VMX` | absolute WSL path to the `.vmx` under `/mnt/c/...` | none — required |
| `RHCSA_VM_IP` | guest IP on VMnet8 | none — SSH is skipped without it |
| `RHCSA_SSH_USER` | guest account used for grading | `student` |
| `RHCSA_SSH_PORT` | guest SSH port | `22` |
| `RHCSA_SSH_KEY` | private key for that account | `~/.ssh/rhcsa_lab` |
| `RHCSA_VMRUN` | path to `vmrun.exe` | the VMware default install path |
| `RHCSA_TRANSPORT` | force `ssh`, `vmrun` or `fake` and skip probing | unset — probe |
| `RHCSA_GUEST_PASSWORD` | guest password, needed only by the `vmrun` transport | unset |
| `RHCSA_SNAPSHOT` | snapshot to revert to | `clean` |
| `RHCSA_PORT` | API port | `5175` |
| `RHCSA_CONTENT` | content bank root | `content` |

The npm scripts load `.env.local` for you — `node --env-file-if-exists` for
the API and the CLI, `set -a; . ./.env.local` for `test:vm`. If you run
`node src/cli/index.ts` directly, pass `--env-file-if-exists=.env.local`
yourself or it will exit saying `RHCSA_VMX is not set`.

Nothing here needs your Red Hat credentials. Do not put them in a file in
this repo.

### Checking the content

```bash
npm run coverage                                 # objectives with and without tasks
npm run validate -- storage/014-grow-home-lv     # one task, 6 fixtures
npm run validate                                 # the whole bank - see the warning below
npm test                                         # unit tests, no VM needed
npm run test:vm                                  # VM-dependent suites, including the e2e
```

`npm run validate` reverts the snapshot repeatedly and reboots the guest for
most fixtures. Do not run it while you are studying in the Lab screen — the
revert will take your work with it.

With no arguments it loads the whole bank, and the transport is chosen once
for the run: a single task declaring `transport: vmrun` pushes every fixture
through the slow path. Name the SSH tasks explicitly and run the `vmrun` ones
separately. `docs/exit-criterion.md` has the two commands.

### Adding content

Copy `content/tasks/storage/014-grow-home-lv/` as the reference shape. The
rules the validator enforces:

- Two or more independent solutions. Two spellings of the same command are
  one solution; they do not catch a grader that over-fits.
- At least one anti-solution, with `# expect-fail:` naming the checkpoint
  ids it must fail.
- `# baseline-fail:` on `grade.sh` naming every goal checkpoint — the ones
  that must fail on an untouched machine. Invariant checkpoints are left out.
- Every checkpoint id is a literal. No loops, no interpolated ids: the masked
  checkpoint count is derived by reading the script, counting distinct ids.
  Emitting one id from several branches is normal and changes nothing.
- `requires_concepts` lists cards that exist. A missing card is a load error,
  not a warning.
``````

- [ ] **Step 8: Do the run**

This is the exit criterion. Not a test of the code — a test of whether the thing works on a person.

1. `npm run dev:server` in one terminal, `npm run dev:web` in another.
2. Open the picker, choose **Practice** and `Grow /home to 12 GiB`.
3. **Close every other window.** No PDF, no browser tab, no notes. That constraint is the entire point: the app was built so the book is not needed, and the only way to find out is to not have it.
4. Solve the task using the terminal, the prompt, and F2 as many times as you need.
5. Grade it, finish it, and fill in `docs/exit-criterion.md` — including the "did you want to open the book" question.

If the answer to that question is yes, Phase 1 still passed: the spine works, and you now know exactly which card to write first. Write it down in the record. If you could not solve it at all from the cards, that is a content bug against Task 21 — the cards need the missing fact — not a reason to hold Phase 1 open.

- [ ] **Step 9: Commit and tag**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add test/vm/e2e-exit-criterion.vm.test.ts docs/exit-criterion.md \
  docs/coverage-phase-1.md README.md package.json && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "test(e2e): prove the Phase 1 exit criterion end to end

Drives createApp against the real VM: bank, session, guest, grader,
verdict A, reboot, verdict B, rating. No browser - the Lab screen's own
logic is covered against fakes, and a headless browser would add three
more ways for this to fail that all look alike.

Two assertions carry the pedagogy rather than the plumbing: the rung-2
nudge must not contain lvextend, and the concept cards must be long
enough to have taught something. Neither can prove a card works, which
is why docs/exit-criterion.md ends with a question for a human."
```

Then tag it, so the point where the spine first worked stays findable:

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git tag -a phase-1 -m "Phase 1: five tasks, ten cards, graded end to end with the reboot check"
```

- [ ] **Step 10: Confirm Phase 1 is done**

All five must be true. Anything false is unfinished work, not a judgement call.

1. `npm test && npm run typecheck` — green, no VM involved.
2. `npm run test:vm` — green, including `e2e-exit-criterion`.
3. Both validate runs from Step 4 — 24/24 then 6/6 fixtures ok.
4. `docs/exit-criterion.md` has a filled-in run with a real date and a real answer to the book question.
5. `git tag` lists `phase-1`.
