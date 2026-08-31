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
- Modify: `src/engine/vm/ssh.ts` (extract `sshArgs`, mandate 1)
- Modify: `src/engine/disclosure/ladder.ts` (export `TOP_RUNG` and `RUNGS`, mandate 4) — omitted from Step 21's stage list; staging that list verbatim yields a commit that does not typecheck
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
  - `interface GradeReport { passed; total; expectedTotal; incomplete; allPassed; rebooted; rebootError?; regressionCount; checkpoints?; regressions? }` — `expectedTotal`/`incomplete` added by mandate 7
  - `function countCheckpoints(gradeScript: string): number`
  - `function maxRungFor(mode: SessionMode): Rung`
  - `function reportFor(mode: SessionMode, result: GradeResult, revealed: boolean, expectedTotal: number): GradeReport` — fourth argument added by mandate 7
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

