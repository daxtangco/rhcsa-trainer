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

