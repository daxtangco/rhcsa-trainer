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

**Two runs, not one.** `npm run validate` with no arguments loads the whole bank, and `require` is derived as `vmrun` if *any* task asks for it (`src/cli/index.ts:188`) — so a single full-bank run would push all thirty-two fixtures through the slow transport and take most of a day. Split it the way Task 22 did:

```bash
cd /home/daxtangco/rhcsa-trainer

# the four ssh tasks: 26 fixtures, 45-60 minutes
npm run validate -- \
  storage/014-grow-home-lv \
  users/006-team-provisioning \
  selinux/019-httpd-alt-port \
  systemd/017-boot-time-service > /tmp/validate-ssh.log 2>&1
echo "exit=$?"
tail -40 /tmp/validate-ssh.log

# the vmrun task on its own: 6 fixtures, 15-20 minutes
export RHCSA_GUEST_PASSWORD='<the student account password>'
npm run validate -- troubleshooting/028-restore-remote-access > /tmp/validate-vmrun.log 2>&1
echo "exit=$?"
tail -20 /tmp/validate-vmrun.log
```

Expected: `transport: ssh` and **`26/26 fixtures ok`** from the first run, `transport: vmrun` and **`6/6 fixtures ok`** from the second. Thirty-two fixtures, `exit=0` both times.

**These numbers were 24/24 and "thirty" and are now corrected — the correction is already applied here, so mandate 4 has nothing left to do in this step.** `MEASURED`, and the counting rule is worth stating because it is not the obvious one: a run's fixture count is **not** the number of files under `solutions/` and `antisolutions/`. Each task also gets a synthetic empty `no-action` baseline fixture (`src/engine/validate/harness.ts:67`), and the `fixture-inventory` gate is pushed into the results **only when it fails** (`harness.ts:308`), so a healthy bank contributes none. Per task that gives `1 + solutions + antisolutions` = **019 8, 014 6, 017 6, 006 6, 028 6** — the same 8/6/6/6/6 shape the coverage table uses. The four ssh tasks are 26, 028 alone is 6, and the bank is 32. Only 028 declares `transport: vmrun` (`task.yaml:21`). If you recount from the file tree alone you will get 22 and 5 and think this brief is wrong; it is not, and I made exactly that mistake first.

**One real defect fixed in the commands above.** The `2>&1 | tail -40` form they used to have made `echo "exit=$?"` report **`tail`'s** status rather than the validator's, so a failing validate run printed `exit=0`. That is precisely the defect class this project keeps finding — a tool reporting success when it did not do what was asked — sitting inside the step that is supposed to catch it. The redirect-then-tail form is deliberate: do not put the pipe back. If you want a pipeline, the status you need is shell-specific (`${PIPESTATUS[0]}` in bash, `$pipestatus[1]` in zsh) and the user's shell here is zsh. Mandate 4's line 145 flags the same bug wherever else it appears.

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
3. Both validate runs from Step 4 — 26/26 then 6/6 fixtures ok.
4. `docs/exit-criterion.md` has a filled-in run with a real date and a real answer to the book question.
5. `git tag` lists `phase-1`.
