# Task 23 report — HTTP API and browser terminal bridge

Branch `phase-0-1`, BASE `9300d2b4d32742dfa91916acdc7fe35205b17c9b`,
commit `ab32303c80646e51cf30c3fed2e5e83f84939d68`
(`git status --porcelain` empty afterwards; `.superpowers/` is git-ignored, so
this report is not in the commit).
Node v22.23.2, vitest 3.2.7, tsc from the repo's TypeScript 5.8.

**Nothing in this task was exercised against a real VM or a real browser.** No
`vmrun` ran, no VM was started, stopped, snapshotted or reverted; `provision.sh`
was not run; no `ssh` connection was made to any guest; `.env.local` was neither
created, read nor modified; no browser opened `/ws/terminal`. Step 20, the only
acceptance step that needs a guest, is deferred — see the last section. The
`attachTerminal` tests do bind a real loopback HTTP server on an ephemeral port
inside the test process and speak real WebSocket to it, with a fake pty; that is
the only network activity in this task and it never leaves `127.0.0.1`.

---

## 1. `test/vm/ssh.test.ts` before and after mandate 1's refactor

`test/vm/ssh.test.ts` is **unmodified** (it does not appear in `git status
--porcelain`, below). To get the "before" run I copied my `ssh.ts` aside,
restored `git show HEAD:src/engine/vm/ssh.ts`, ran the file, then copied mine
back and confirmed the diff.

Before (BASE `ssh.ts`, inline `#args()`):

```
 RUN  v3.2.7 /home/daxtangco/rhcsa-trainer
 ✓ test/vm/ssh.test.ts (12 tests) 213ms
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

After (`sshArgs` extracted, with the no-IP throw moved into it):

```
 RUN  v3.2.7 /home/daxtangco/rhcsa-trainer
 ✓ test/vm/ssh.test.ts (12 tests) 213ms
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

The refactor is argv-preserving. I diffed the option list myself rather than
trusting the mandate's `COMMAND` label, and it matches byte for byte in the same
order: `BatchMode=yes`, `StrictHostKeyChecking=accept-new`,
`UserKnownHostsFile=${KNOWN_HOSTS}`, `ConnectTimeout=10`, `LogLevel=ERROR`,
`-i`, `-p`, `user@ip`. `'bash -s'` stays in `#args()`, because it is how the
transport feeds a script on stdin and the terminal appends `-tt` plus an
interactive command instead.

Mandate 1's point — the part the brief got wrong — was that a bare `sshArgs`
without the guard would build `student@` out of a missing IP. The guard is
inside `sshArgs`, so both consumers inherit it. `test/vm/ssh.test.ts:98`
(`exec throws a legible error with no IP`) still passes unmodified, which is what
proves the throw did not move out from under the transport.

## 2. Mandate 2's upgrade tests, and what `serve` actually does

```
 ✓ test/server/terminal.test.ts > attachTerminal > refuses an upgrade from a foreign origin and spawns no shell 8ms
 ✓ test/server/terminal.test.ts > attachTerminal > accepts an upgrade from an allowed origin and spawns the shell at the requested size 4ms
 ✓ test/server/terminal.test.ts > attachTerminal > accepts an upgrade with no Origin header at all 2ms
 ✓ test/server/terminal.test.ts > attachTerminal > refuses an upgrade on any other path 1ms
```

**What `serve` returns, measured.** `ServerType` is exported from
`@hono/node-server` and is `Server | Http2Server | Http2SecureServer`. So the
brief's `serve(...) as unknown as Server` is replaceable with an honest
`instanceof Server` narrowing, which is what `src/server/index.ts:77` does — a
double cast through `unknown` there would be an admission that nobody checked.

**Does it default to loopback? No.** `node_modules/@hono/node-server/dist/index.mjs:1305`:

```js
	server.listen(options?.port ?? 3e3, options.hostname, () => {
```

`options.hostname` is passed straight through, and Node's `server.listen` binds
`::` (all interfaces) when the host argument is `undefined`, `127.0.0.1` when it
is set. So without an explicit hostname this server would have been reachable
from the whole LAN. `src/server/index.ts:39` sets `const HOST = '127.0.0.1'` and
passes it.

Both halves of mandate 2 are required and neither substitutes for the other:

- Loopback binding stops another device on the network from reaching the shell.
- It does **not** stop a web page. A WebSocket upgrade is exempt from the
  same-origin policy, so any site the user visits can open `ws://localhost:5175`
  through the user's own browser. The `Origin` check is what stops that.

A *missing* `Origin` is allowed on purpose (a non-browser client such as `wscat`
sends none; a browser always sends one). That is the part of the check that looks
like a hole and is not, and there is a named test for it so a later reader does
not "fix" it.

**My own break-and-revert on this gate** (not required by the mandates; I added
it because a security check that no test can fail is not a check). Removing the
four-line gate from `src/server/terminal.ts` gives exactly one failure:

```
 × attachTerminal > refuses an upgrade from a foreign origin and spawns no shell 13ms
   → expected 'open' to be 'refused' // Object.is equality
 ❯ test/server/terminal.test.ts:163:79
```

`https://anywhere.example` gets an open shell. Restored; `grep -c
'allowedOrigins.has' src/server/terminal.ts` → 1, and the file is back to 10
passing tests.

**Design note.** The `attachTerminal` tests use a real ephemeral loopback
`http.Server` and a real `ws` client rather than a fake socket. "Was a pty
spawned" is only observable past `handleUpgrade`, and with a fake socket the
origin test would have gone green without ever reaching the gate — a test that
reports success without doing what was asked, which is the defect class this
task is about. `TerminalDeps.allowedOrigins` is **required with no default**, so
forgetting it denies browsers rather than failing open.

## 3. Mandate 5's before/after table, reproduced from my implementation

Generated by importing the brief's verbatim `commandSketch` (kept at
`/tmp/sketch-before.ts`) and mine from
`src/engine/disclosure/content.ts`, over the eight cases in the mandate:

```
brief SOLUTION
  before: ["lvextend","xfs_growfs","blkid","sed","printf","tee","systemctl"]
  after : ["lvextend","xfs_growfs","blkid","sed","printf","tee","systemctl"]
brief HEREDOC
  before: ["tee","systemctl"]
  after : ["tee","systemctl"]
real solution 02
  before: ["lvextend","blkid","sed","home[[:space:]]","d'","printf","tee","systemctl"]
  after : ["lvextend","blkid","sed","printf","tee","systemctl"]
bracket test
  before: ["]]","echo"]
  after : ["echo"]
single bracket
  before: ["fstab","cat"]
  after : ["cat"]
for loop
  before: ["u","useradd"]
  after : ["u","useradd"]
case
  before: ["case","a","lvs","esac"]
  after : ["a","lvs"]
env prefix
  before: ["lvs"]
  after : ["lvs"]
```

`real solution 02` is the actual file
`content/tasks/storage/014-grow-home-lv/solutions/02-lvextend-r-by-uuid.sh`, read
from disk, not a synthetic. Before the fix, rung 4 showed a student
`home[[:space:]]` and `d'` as if they were commands to learn.

The two expectations the brief already had (`brief SOLUTION`, `brief HEREDOC`)
are unchanged, so the fix is additive rather than a re-specification.

The three changes were: extra shell keywords in `NOISE` (`in case esac until
select function time test ! ] ]]`), a `COMMAND_SHAPE` regex
(`/^[A-Za-z_][A-Za-z0-9_.+-]*$/`), and — the one that does most of the work — the
inner word loop now `break`s at the command position instead of scanning the
whole line, so arguments can never be mistaken for commands.

**Residual limits, documented in the doc comment rather than papered over:**
`for u in alice bob` still emits `u`, and a `case` label still emits `a`. Both
are the first word of their line and cannot be distinguished from a command
without a shell parser. The mitigation is an authoring convention — a task's
*first* solution should be straight-line commands — and the sketch is a hint, not
a grader, so a stray word costs a student nothing that a wrong-looking
`home[[:space:]]` did.

## 4. Mandate 7's break-and-revert

`src/server/session.ts:107` is `allPassed: allPassed(v) && !incomplete,`. I
replaced it with `allPassed: allPassed(v),` — the brief's version — and ran
`test/server/session.test.ts`:

```
 ❯ test/server/session.test.ts (17 tests | 1 failed) 10ms
   × reportFor > refuses to call a truncated grader run a pass 4ms
     → expected true to be false // Object.is equality

 FAIL  test/server/session.test.ts > reportFor > refuses to call a truncated grader run a pass
AssertionError: expected true to be false // Object.is equality
- Expected  false
+ Received  true
 ❯ test/server/session.test.ts:168:25
    166|     expect(r.expectedTotal).toBe(5)
    167|     expect(r.incomplete).toBe(true)
    168|     expect(r.allPassed).toBe(false)

 Test Files  1 failed (1)
      Tests  1 failed | 16 passed (17)
```

Restored; grep confirms line 107 is back and the file is 17 passing.

**I confirmed by measurement that this is a real bug and not just a theoretical
one, because the mandate labelled the mechanism `TRACED`.** Feeding
`parseVerdict` a grader transcript that stops mid-line yields a *short*
`checkpoints` array with the partial line routed to `noise` — `parseVerdict`
never throws, by design — and `allPassed(v)` is `v.checkpoints.length > 0 &&
every(status === 'pass')`, so a run that emitted 2 of 5 checkpoints and then died
returns `true`. A student who broke the guest badly enough to kill the grader
half way would have been told they passed. `expectedTotal` comes from
`countCheckpoints` over the grade script, which is static and cannot be truncated
by a sick guest, so it is the right authority for the comparison.

`expectedTotal` and `incomplete` are both on the wire, not just internal —
`test/server/app.test.ts` asserts `expectedTotal === 2` and `incomplete ===
false` on a real `/grade` response — so Task 24 can render the distinction
instead of silently dropping it.

## 5. Cast inventory

```
$ grep -rnE "\bas ([A-Z]|unknown|const\b)" src/ test/ scripts/ | grep -v "as const"
src/engine/vm/config.ts:54:    forceTransport: forced as TransportKind | undefined,
test/validate/expectations.test.ts:47:    })() as ContentError
test/validate/expectations.test.ts:81:    })() as ContentError
test/validate/expectations.test.ts:93:    })() as ContentError
test/validate/expectations.test.ts:105:    })() as ContentError
test/validate/expectations.test.ts:122:    })() as ContentError
test/validate/expectations.test.ts:137:    })() as ContentError
test/validate/expectations.test.ts:152:    })() as ContentError
test/content/task.test.ts:43:    const problems = (err as ContentError).problems.join('\n')
test/content/task.test.ts:57:    expect((err as ContentError).problems.length).toBeGreaterThanOrEqual(11)
test/content/task.test.ts:61:    const err = (await loadTask(`${FIXTURES}bad`).catch((e: unknown) => e)) as ContentError
test/content/objectives.test.ts:45:    })() as ContentError
test/content/objectives.test.ts:68:    })() as ContentError
test/content/objectives.test.ts:89:    })() as ContentError
test/content/objectives.test.ts:108:    })() as ContentError
test/content/objectives.test.ts:127:    })() as ContentError
test/content/objectives.test.ts:146:    })() as ContentError
test/content/objectives.test.ts:170:    })() as ContentError
test/content/objectives.test.ts:186:    })() as ContentError
src/engine/grading/verdict.ts:29:  const cp: Checkpoint = { id: v.id, desc: v.desc, status: v.status as CheckpointStatus }
test/content/bank.test.ts:102:    const joined = (err as ContentError).problems.join('\n')
test/content/bank.test.ts:117:    const joined = (err as ContentError).problems.join('\n')
test/content/bank.test.ts:131:    const joined = (err as ContentError).problems.join('\n')
test/content/bank.test.ts:147:    expect((err as ContentError).problems.join('\n')).toMatch(/objectives\.yaml/)
test/content/bank.test.ts:156:    const joined = (err as ContentError).problems.join('\n')
test/content/bank.test.ts:176:    const joined = (err as ContentError).problems.join('\n')
test/content/bank.test.ts:199:    expect((result.error as ContentError).problems.join('\n')).toMatch(
src/engine/content/task.ts:96:  const scope = SCOPES.includes(raw.scope as string) ? (raw.scope as TaskScope) : 'exam-objective'
src/engine/content/task.ts:101:  const weight = WEIGHTS.includes(raw.weight as string) ? (raw.weight as TaskWeight) : 'medium'
src/engine/content/task.ts:108:    ? (rawTransport as TaskTransport)
test/content/concept.test.ts:28:    const err = (await loadConcept(`${FIXTURES}bad.md`).catch((e: unknown) => e)) as ContentError
test/content/concept.test.ts:34:    const err = (await loadConcept(`${FIXTURES}bad.md`).catch((e: unknown) => e)) as ContentError
test/content/concept.test.ts:45:    )) as ContentError
test/content/concept.test.ts:53:    )) as ContentError
```

Counts by tree: **`src` 5, `test` 29, `scripts` 0** — 34 lines total, exactly the
mandate's number and exactly the baseline. **My measurement agrees with mandate
3's.** All 34 are pre-existing and parked; none is mine.

`as unknown as` / `as never`:

```
$ grep -rnE "as unknown as|as never" src/ test/ scripts/
src/engine/grading/grader.ts:91:  // No point rebooting to test persistence of work that was never done.
test/lib/assert.test.ts:118:  it('rejects a filesystem that was never grown', async () => {
```

Both are the English words "was never" in prose. **Zero real occurrences.**

Where the brief would have added casts, I used:

| Brief | What I wrote instead |
| --- | --- |
| `X as unknown as TaskSpec`, `as never` in fixtures | `satisfies TaskSpec` / `satisfies ConceptSpec` / `satisfies VmConfig` |
| `serve(...) as unknown as Server` | `if (!(server instanceof Server)) throw` |
| `([1,2,3,4,5] as Rung[])` | `RUNGS` exported from `ladder.ts` (mandate 4) |
| `all[all.length - 1]` for the top rung | `rungContent(TOP_RUNG, ctx)` (mandate 4) |
| `body.mode as SessionMode` | `MODES: Record<SessionMode, true>` + `isSessionMode` predicate |
| request body property reads | `isRecord(raw) ? raw : {}` |
| `(await res.json()).id as string` | `str(await res.json(), 'id')` — see below |

**One typecheck failure the brief caused, and how I fixed it.** Hono's
`res.json()` resolves to `Promise<unknown>`, not `any`, so the brief's
`const body = await res.json(); body.tasks[0].id` produced 40 errors
(`TS2571`/`TS18046`) in `test/server/app.test.ts`, plus one `as string`. I added
four small readers to that file — `at`, `items`, `str`, `num` — built on the
project's existing `isRecord` idiom. A wrong *path* throws and names the key and
what was actually there; a missing *leaf* returns `undefined`, because "this
field is absent" is what the masking tests assert. That distinction is
deliberate: a renamed field now fails the test that reads it instead of quietly
comparing `undefined` to `undefined`.

A second brief error in the same file: `new Map([[TASK.id, TASK], [TASK_VMRUN.id,
TASK_VMRUN]])` does not typecheck once mandate 10's second fixture exists,
because the two differ in `rebootCheck` and inference picks the first one's
literal type. Fixed with an explicit type argument, `new Map<string,
TaskSpec>(...)`, which is a declaration rather than a cast.

## 6. Full suite and typecheck

```
$ npm run typecheck
> rhcsa-trainer@0.1.0 typecheck
> tsc --noEmit
```

Clean, exit 0, no output.

```
$ npx vitest run
 Test Files  27 passed (27)
      Tests  301 passed (301)
   Duration  1.03s
```

**Observed totals: 301 tests in 27 files, all passing.** Baseline read from
`git log` at BASE `9300d2b` ("Gates: tsc exit 0, vitest 246/23") and from the
lead's own in-session run: 246 tests, 23 files. Delta **+55 tests, +4 files**,
which accounts for exactly the four files this task adds:

| File | Tests |
| --- | --- |
| `test/disclosure/content.test.ts` | 12 |
| `test/server/session.test.ts` | 17 |
| `test/server/app.test.ts` | 16 |
| `test/server/terminal.test.ts` | 10 |
| | **55** |

No pre-existing test file changed count. `test/vm/ssh.test.ts` is still 12 and is
byte-identical to BASE.

The content coverage gate also still passes (`node src/cli/index.ts coverage`,
exit 0, `untaught concepts: 0`). Nothing under `content/` was touched.

## 7. Working tree

Before staging:

```
$ git status --porcelain
 M package-lock.json
 M package.json
 M src/engine/disclosure/ladder.ts
 M src/engine/vm/ssh.ts
?? src/engine/disclosure/content.ts
?? src/server/
?? test/disclosure/content.test.ts
?? test/server/
```

Every entry is this task's. **No files outside this task's list are modified**, so
there is nothing to note as not-mine and nothing was reverted.

**Correction to the brief's Step 21 stage list.** The brief stages
`src/engine/vm/config.ts`, which this task does not modify (mandate 9 copies its
*validation shape* into `readPort`, it does not change the file), and it omits
`src/engine/disclosure/ladder.ts`, which mandate 4 does modify. Staging the
brief's list verbatim would produce a commit that does not typecheck, because
`TOP_RUNG` and `RUNGS` would be missing while `src/server/app.ts` imports them. I
staged by name with `config.ts` dropped and `ladder.ts` added; everything else in
the list is unchanged, as is the commit message.

## 8. Mandate 8 (`fileURLToPath`) and mandate 9's four items

```
$ grep -rn "fileURLToPath|\.pathname" test/server/ test/disclosure/content.test.ts src/server/
test/server/session.test.ts:2:import { fileURLToPath } from 'node:url'
test/server/session.test.ts:72:      fileURLToPath(new URL('../../content/lib/assert.sh', import.meta.url)),
src/server/terminal.ts:135:    if (url.pathname !== '/ws/terminal') {
```

The one new file that resolves a repo path uses `fileURLToPath`, not
`new URL(...).pathname`. The single `.pathname` in new code is a *request* path
on a WebSocket upgrade, which is what `.pathname` is for; it is not a filesystem
path and does not join the parked set. The seven parked `.pathname` test files are
untouched.

Mandate 9's four items, all done: `readPort` validates `RHCSA_PORT` with
`loadVmConfig`'s shape and a message naming the variable; the `/hint` comment now
says `advanceRung` threw because the session is at its mode's cap (keeping the 409
and the reasoning for 409 over 400); rung 4 emits an explicit line for the empty
sketch instead of a dangling heading; and `maxRungFor` is added to the brief's
`Produces` block — see below.

Mandate 9's `RHCSA_PORT` validation is the one item I could not execute, because
it lives in the untested `index.ts` (see the coverage-gap section). It is reasoned
against `loadVmConfig`, not measured.

Mandate 9's fourth item (documentation only) is done in `task-23-brief.md`'s
`Produces` block: `maxRungFor` added. While there I corrected the two signatures
mandate 7 changed — `GradeReport` gained `expectedTotal` and `incomplete`, and
`reportFor` gained a fourth parameter — and added the two `Modify:` lines the
Files block was missing (`src/engine/vm/ssh.ts`,
`src/engine/disclosure/ladder.ts`), since the missing `ladder.ts` line is what
made Step 21's stage list wrong. `.superpowers/` is git-ignored, so none of this
is in the commit.

## Files

New:

- `src/engine/disclosure/content.ts` — `RungKind`, `RungContent`, `RungContext`, `commandSketch`, `rungContent`
- `src/server/session.ts` — `SessionStore`, `countCheckpoints`, `maxRungFor`, `reportFor`, `GradeReport`
- `src/server/lab.ts` — `LabRuntime` seam over transport + `VmController`
- `src/server/app.ts` — `createApp(deps): Hono`
- `src/server/terminal.ts` — `PtyLike`, `bridge`, `spawnSshPipe`, `attachTerminal`
- `src/server/index.ts` — process entry: `readPort`, loopback `HOST`, `ALLOWED_ORIGINS`
- `test/disclosure/content.test.ts`, `test/server/session.test.ts`, `test/server/app.test.ts`, `test/server/terminal.test.ts`

Modified:

- `src/engine/vm/ssh.ts` — extracted `sshArgs` with the no-IP guard inside it (mandate 1)
- `src/engine/disclosure/ladder.ts` — added `TOP_RUNG` and `RUNGS` (mandate 4)
- `package.json` / `package-lock.json` — `hono`, `@hono/node-server`, `ws`, `@types/ws`, `dev:server`

`content/`, `src/engine/grading/*`, `src/engine/content/*`, `src/engine/validate/*`
and `content/lib/assert.sh` are untouched.

## Known coverage gap: `src/server/index.ts` is not executed by any test

It has no test and was never run. Running it requires `.env.local` (off limits
this session) and would call `chooseTransport`, which probes a real VM
(prohibited). What it contains that is not covered elsewhere:

- `readPort` — the `RHCSA_PORT` validation. Reasoned against `loadVmConfig`'s
  `RHCSA_SSH_PORT`, whose shape it copies; not executed. I kept it inline rather
  than adding a seventh `src/` file outside the brief's layout.
- `HOST = '127.0.0.1'` reaching `serve`. The *consequence* of omitting it is
  measured (section 2, from `@hono/node-server`'s source); that this line is
  wired up correctly is read, not run.
- The `instanceof Server` narrowing and the `ALLOWED_ORIGINS` set contents.
  `attachTerminal`'s behaviour given a set is tested; that production passes
  *this* set is read, not run.

Step 20 is what would exercise all of it. Flagging it rather than claiming the
file is covered.

## Step 20: deferred, nothing executed

**No part of Step 20 ran.** There is no RHEL 9 VM in this environment — the ISO
is the user's and unprovisioned — and the lead's constraints prohibit any VM
operation, `scripts/provision.sh`, and starting a long-running server. Step 20 is
the task's only manual check; everything else is covered by the tests above.

Step 20's `tasks: 5` and `"checkpointTotal": 5` are **predictions about the
content bank, not assertions**, and I have deliberately not encoded either number
in a test. Task 21/22 own the bank and both numbers move when content is added;
a test pinning them would fail for a reason that has nothing to do with the
server. `test/server/app.test.ts` asserts against its own two-task fixture bank
instead.

What each numbered check will prove when someone runs it against a provisioned
guest:

1. `{"ok":true,"transport":"ssh","tasks":N}` — proves the process starts at all
   (this is the only thing that executes `src/server/index.ts`), that
   `loadVmConfig` + `chooseTransport` selected the **ssh** transport rather than
   silently falling back to the fake, and that `loadBank` read the real
   `content/` tree. `N` is whatever the bank holds; only `"transport":"ssh"` is
   load-bearing here, because a `"fake"` value means every later check is
   measuring nothing.
2. The task list contains the real task ids — proves `/api/tasks` serialises the
   real `TaskSpec`s and that `summary()` omits `prompt` on live content, not just
   on a fixture.
3. The session response with `"maxRung":5` for practice, and a
   `checkpointTotal` matching the number of distinct `ck` ids in that task's
   `grade.sh` — proves the two things no unit test can: that the snapshot
   **revert actually happened before `setup.sh` ran** (the 10–20 s wait is the
   revert; a fast response means the revert was skipped and the student has an
   untouched machine), and that `countCheckpoints` over
   `assertLib + grade.sh` gives the right total for real content rather than for
   `SCRIPTS`. It is also the first end-to-end exercise of `loadTaskScripts`
   through the API.
4. The rung-2 nudge naming the LVM objective and both concept card titles **with
   no commands in it** — proves the disclosure ladder holds on real content:
   rung 2 must not leak what rungs 4 and 5 sell. A command appearing here is a
   content bug the unit tests cannot see, because they use a one-line fixture
   solution.
5. A grade report with `lv-home-size` and `fs-home-size` failing on an untouched
   guest, `"rebooted":true`, and `"incomplete":false` — proves the grader runs on
   the guest, that `reboot_check: true` really reboots and re-grades (the 60–90 s
   wait), that `finalVerdict` scores the post-reboot verdict, and — the part
   mandate 7 added — that a **complete** real run reports `incomplete: false` so
   the new guard does not false-positive on healthy output. This is the check
   that would catch it if `expectedTotal` and the real checkpoint count disagree
   for live content.

Then the `wscat` step proves the terminal end to end: that `spawnSshPipe`'s
`ssh -tt` really allocates a guest PTY, that `stty cols/rows` lands, and that
output comes back as text frames. Note for whoever runs it: `wscat` sends **no
`Origin` header**, so it exercises the deliberately-allowed no-Origin path, not
the browser path. Confirming the browser path needs Task 24's UI in a real
browser, and a page from any other origin being refused — neither was done here.

---

## Fix round 1

Fix round for the `CHANGES REQUIRED` review. Started from a clean tree at
`ab32303`; the previous dispatch of this round left nothing behind. Everything
below was measured on this host unless it says otherwise.

### Disposition per finding

| # | Sev | Disposition |
|---|-----|-------------|
| F1 | HIGH | Fixed — `ws.on('error')` ends the terminal, not the process. Pinned by a raw-socket test that sends a real bad frame. |
| F2 | HIGH | Fixed — `spawnPty` wrapped in `try`; the reason goes over the socket, then close 1011. Endpoint stays attached and fails per connection. |
| F3 | HIGH | Fixed — `/grade` and `/finish` both 409 once `phase === 'graded'`. |
| F16 | HIGH | Fixed — `countCheckpoints` sees a `ck` call after `;`, `&&`, `\|\|` or `\|`. Both invariants re-measured and unmoved. |
| F4 | MEDIUM | Fixed — `reportFor` compares distinct ids to distinct ids via `statusById`. |
| F5 | MEDIUM | Fixed — quoted runs no longer contribute words. Measured against the real bank. |
| F6 | MEDIUM | Fixed — the old test kept, re-commented as what it actually proves, plus 7 tests that fail for the right reason. |
| F7 | MEDIUM | **Parked as instructed** (controller ruled against the reviewer): endpoint stays ungated; the false "rung 3 is gated" claim is corrected and a Task 24 note added. |
| F8 | MEDIUM | Fixed — `HEREDOC_START` anchored, and `<<` is only a heredoc where it really is one. |
| F17 | MEDIUM | **Not adjudicated in the brief — left unchanged and flagged below.** Not silently widened. |
| F9 | LOW | Fixed — `child.on('error')` reports into the terminal and exits that pty only. |
| F10 | LOW | Fixed — 30 s ping/pong heartbeat, `terminate()` on a missed pong, interval `unref`'d and cleared on close. |
| F11 | LOW | Fixed — `at()` docstring corrected, plus `expectMissing()` so the two absence assertions have teeth. |
| F12 | LOW | Fixed — a non-object body is blamed on the body, not reported as `unknown task: undefined`. |
| F13 | LOW | Fixed (documented) — the `upgrade` listener now states that it owns every upgrade and that a second endpoint must share one dispatching listener. |
| F14, F15 | INFO | No code change; the controller has recorded both. |
| Ruling 3 | — | Done — `src/server/config.ts` extracted, side-effect-free, 7 tests including the mandate 2(a) loopback regression. |

### F16 + F4: the two directions, and the invariants

The counter is one line-scanner with three jobs: skip a real heredoc body, drop a
comment, and find `ck` calls anywhere a command can begin.

```
CK_CALL = /(?:^[ \t]*|[;&|][ \t]*)ck(?:_pass|_fail|_skip)?[ \t]+["']?([a-z0-9][a-z0-9-]*)/g
```

Measured after the rewrite, on the shipped content (`/tmp/ck-measure2.ts`, read-only):

```
assert.sh = 0        selinux/019 = 8   storage/014 = 5
systemd/017 = 5      troubleshooting/028 = 5   users/006 = 8
```

Both mandated invariants hold: `assert.sh` still counts 0 (its `ck <id> "desc" $?`
usage line on line 60 is inside a comment, and `<id>` would not match the id class
anyway), and none of the five grader counts moved. The pattern is not greedy
enough to disturb them, which was the condition the addendum set.

18 shape cases are pinned in `test/server/session.test.ts`: four separator forms,
a mixed script that yields 2, a comment at column 0 and inline, `assert.sh`'s own
usage line, two in-string forms, three heredoc forms (quoted, unquoted, `<<-`),
a herestring (`<<<` must **not** start a body, so the next line still counts), a
quoted id, and the same id on two branches counting once.

F4 itself is the unit fix, in `reportFor`, not in the grader:

```
const status = statusById(v)
const incomplete = status.size < expectedTotal
passed: [...status.values()].filter((s) => s === 'pass').length
total: status.size
```

The revealed checkpoint list is deduped last-wins through a `Map`, so the array a
client renders can no longer disagree with the `total` the same response reports.
**Note for Task 24: `total` and `passed` are distinct checkpoint ids, not lines.**
A truncated run that emits `fstab-entry` twice now reports `total: 2` against
`expectedTotal: 3` and `incomplete: true` — pinned by a test.

### F5/F6/F8: the sketch, measured on real content

`commandSketch` gained `scanLine`, which walks the line once and (a) replaces each
quoted run with its own delimiters, so nothing inside it can become a word,
(b) stops at a `#` that starts a word, (c) treats `<<<` as a redirect and `<<`
as a heredoc only when a real delimiter follows.

Before and after, `content/tasks/selinux/019-httpd-alt-port` solution 01:

```
before: ["dnf","sed","Listen","DocumentRoot","tee","semanage","restorecon","firewall-cmd","systemctl"]
after:  ["dnf","sed","tee","semanage","restorecon","firewall-cmd","systemctl"]
```

`Listen 8404` and `DocumentRoot /var/www/alt` are the answer to that task; they were
being handed out at rung 3. 028 solution 02 also stopped leaking `print`.

`test/disclosure/content.test.ts` gained a `describe` block that reads real bank
solutions read-only and asserts no `Listen`/`DocumentRoot`, every entry matching
`/^[a-z]/`, and the real command names still present.

**Residuals, deliberately kept and now pinned by a test that names them as
residuals rather than as behaviour:**

- An unquoted delimiter still leaks: `sed -i s|a|b| /etc/hosts` → `['sed','hosts']`.
- `$EDITOR file` and a leading redirect produce nothing at all.
- `case` labels read as commands: a `case` block → `['a','echo','b']`.
- **One new under-disclosure:** a quoted command substitution now contributes
  nothing from inside itself, so `nmcli … "$(cat /etc/rhcsa-conn)"` in
  troubleshooting/028 solution 01 no longer contributes `cat` — the sketch says
  `nmcli` only. Fail-closed, on live content, documented in the docstring. I did
  not chase it; a redactor that under-discloses at rung 3 is the safe direction,
  and closing it means lexing substitutions, which is a different change.

The docstring no longer claims "neither can leak an argument", which was the
sentence F6 was really about.

The counter and the sketch keep **separate** line scanners on purpose: a quoted id
(`ck "fstab-entry"`) must survive in the counter and must not survive in the
sketch. Merging them would force one of the two to be wrong.

### F7, implemented as ruled

`GET /api/concepts/:id` stays ungated. What changed is the false claim: the ladder
decides *what the hint endpoint assembles when you ask for it*, not *whether a card
can be read*. The rungs are a pacing device over an app that replaces the book.

The "rung 3 is gated" wording does not appear in the brief's `Produces` block, so
the correction landed where the claim actually lives — the `MAX_RUNG` docstring in
`src/engine/disclosure/ladder.ts` and a comment in `content.ts`. Both now carry the
Task 24 constraint: **exam realism for cards is a UI affordance, so the session
view must not surface concept-card links in exam mode.**

### F17: not adjudicated, not silently changed

The brief does not rule on F17, so I left `([a-z0-9][a-z0-9-]*)` alone and
documented it as a known miss in the `CK_CALL` comment. It is real: `ck my_id`
counts as `my`, and next to an existing `ck my` that is truth 2 / counted 1 — the
fail-open collision. No shipped grader violates the convention (re-measured this
round: zero ids contain `_` or an uppercase letter), so nothing is wrong today.

Widening to `[A-Za-z0-9_][A-Za-z0-9_-]*` would close it and, measured, moves none
of the six invariant counts. I did not apply it: the one function under a
"if either invariant moves, report it" constraint is the wrong place to make an
unrequested change. It is a one-line patch whenever you want it.

### Ruling 3: `src/server/config.ts`

Side-effect-free, so a test can reach it without `index.ts`'s four side effects
(`loadVmConfig`, `loadBank`, `chooseTransport`, `serve`). `readPort` moved
verbatim, including the two acceptances it shares with `loadVmConfig` (`'0x50'`
is 80, `' 22 '` is 22) — changing the parsing shape while extracting it is what
would make the extraction unreviewable; both stay parked for the branch review.

`index.ts` is now wiring only. The `HOST` regression test calls
`serve({ fetch, port: 0, hostname: HOST })`, asserts `server instanceof Server`,
reads `server.address()` back to prove `127.0.0.1`/IPv4, and closes the server in
a `finally`. That is the gap section "Known coverage gap" in this report described:
one dropped argument between a loopback trainer and an unauthenticated shell in a
passwordless-sudo guest, previously with no test at all.

### Teeth verified by breaking the code

- Renaming an intermediate key made `expectMissing` fail with
  `expected a record at taskzz.0, got undefined`, where the old `toBeUndefined()`
  passed. Restored, re-verified green.
- Deleting `ws.on('error')` reproduced
  `RangeError: Invalid WebSocket frame: RSV1 must be clear` as a vitest
  **unhandled** error with 1 failed test — the F1 blast radius, observed.
  Restored, re-verified green.

### Correction to Step 20 in the section above

Step 20's expectation of `"rebooted": true` is wrong for an untouched guest.
`grader.ts:88-92` only reboots when a checkpoint requires it *and* the guest state
warrants it, so a clean run of storage/014 reports `"rebooted": false`. Whoever
runs Step 20 should expect `false`, and the value of that step is the
`incomplete: false` half — the check that would catch `expectedTotal` and the real
checkpoint count disagreeing on live content.

### Gates

```
npm run typecheck                 exit 0
npx vitest run                    324 passed / 28 files   (baseline 301 / 27)
node src/cli/index.ts coverage    exit 0, zero `problem:` lines
```

+23 tests, +1 file (`test/server/config.test.ts`). Per file: content 12→19,
session 17→22, app 16→18, terminal 10→12, config 0→7.

No `enum`, `namespace`, decorator, parameter property or non-null `!` in any
touched file, and a base-vs-tree diff of every `as` hit shows the only new matches
are comment prose and one test name — zero new type assertions. The tree stays at
its pre-existing 5 / 29 / 0, all parked.

Nothing under `content/`, `src/cli/`, `objectives.yaml` or `content/lib/assert.sh`
was modified; the new bank test reads solutions read-only. No VM operation, no
`vmrun`, no `sudo`, no subagents, no `.env*` access, and no server left listening
(every test server is closed in a `finally`, and the API tests go through
`app.request()`).

### Files

Modified: `src/server/terminal.ts`, `src/server/session.ts`, `src/server/app.ts`,
`src/server/index.ts`, `src/engine/disclosure/content.ts`,
`src/engine/disclosure/ladder.ts`, `test/server/terminal.test.ts`,
`test/server/session.test.ts`, `test/server/app.test.ts`,
`test/disclosure/content.test.ts`.

New: `src/server/config.ts`, `test/server/config.test.ts`.

---

## Fix round 2

One finding, adjudicated after round 1: **F17 — fixed.** The id class in `CK_CALL`
is now `[A-Za-z0-9_][A-Za-z0-9_-]*`. Committed separately from round 1 so the
re-review sees it as its own change.

### Why the counter is permissive and the validator is strict

The comment above `CK_CALL` now carries the reasoning, because the widening
otherwise reads as an inconsistency with the project's id convention. It is not.
The convention is lowercase kebab and stays that way; what changed is *who
enforces it*.

A **counter** that cannot see an id fails **open** — the dangerous direction. A
**validator** that rejects an id fails **closed** — a loud authoring error. So the
counter accepts more than the convention allows and enforcement belongs to the
static lint (Task 25's mandate 11), which does not exist yet.

The sharp version of the argument: a strict class bought nothing even on its own
terms. A non-conforming id was never *rejected* by the counter — it was silently
**miscounted**. `ck lv_size` truncated at the underscore to `lv`, collapsed into
the `lv` already in the set, and counted 1 where the grader emits 2. `expectedTotal`
then lands one low, a run that stopped after the first checkpoint matches it,
`incomplete` stays false, and the student is told they passed a checkpoint that
never ran. That is the same fail-open as F4's wrong unit and F16's separator
blindness, arriving through a third door — and with `rhcsa validate`'s emitted-id
check VM-gated and the lint unbuilt, nothing else stands in front of it today.

### The test that would have caught it

`test/server/session.test.ts` → *"does not collide two ids that share a prefix
across a non-convention character"*:

```
ck lv "d" $?
ck lv_size "d" $?      must count 2
ck My-Id "d" $?        must count 1   (previously counted nothing at all)
ck lv-size / ck lv     must count 2   (the convention, still 2)
```

**Teeth verified.** Reverting only the character class and re-running:

```
× countCheckpoints > does not collide two ids that share a prefix across a
  non-convention character
  → expected 1 to be 2
```

That is the collision itself, not a proxy for it. Restored and re-verified green.

### Invariants, re-measured after the widening

```
assert.sh = 0        selinux/019 = 8   storage/014 = 5
systemd/017 = 5      troubleshooting/028 = 5   users/006 = 8
```

Unmoved. Neither direction of the widening touches them: `assert.sh`'s only `ck`
is inside a comment and is stripped before matching, and no shipped grader uses an
id containing `_` or an uppercase letter.

### Gates

```
npm run typecheck                 exit 0
npx vitest run                    325 passed / 28 files   (round 1: 324 / 28)
node src/cli/index.ts coverage    exit 0, zero `problem:` lines
```

+1 test. No new casts, no banned syntax. Only `src/server/session.ts` and
`test/server/session.test.ts` changed.

---

## Fix round 3

Nine findings from the scoped re-review, all fixed. The two that reopened the task
are both in `countCheckpoints`, which has now produced four fail-open or
fail-closed defects across three rounds; this round rewrites its lexer rather than
adding a fifth patch beside the others.

### N1 — fixed. `<<` opened a heredoc where there was none

`HEREDOC_START` was matched against the whole line and knew nothing about quotes,
so `echo "a << b"` opened a heredoc named `b` and **every remaining line of the
grader was discarded**. That is the exact defect F8 fixed one file over, in a
function that was being edited in the same round. Fail-open, and `expectedTotal` is
the only thing mandate 7's truncation guard has: a grader containing such a line
declares fewer checkpoints than it emits, a run that stops early matches the short
total, `incomplete` stays false, and the student is told they passed.

Measured before and after, both directions:

```
echo "a << b"\nck real-id …          before 0   after 1
echo 'x << y'\nck real-id …          before 0   after 1
printf "%s\n" "a << EOF"\n2 cks      before 0   after 2
```

### N2 — fixed. A phantom id from a separator inside a string

The separator alternation F16 added (`[;&|][ \t]*ck`) matched inside string
literals, so `printf "ok; ck phantom-id\n"` declared a checkpoint that does not
exist. Fail-closed: a **complete** run on a correctly solved machine reports
`incomplete` and forces `allPassed` false — a false fail, the direction
`reportFor`'s own comment names as the one to avoid. The round-1 tests only pinned
separator-*free* strings, which is why this got through.

```
printf "ok; ck phantom-id\n"\nck real-id …   before 2   after 1
echo "done; ck it later"\nck real-id …       before 2   after 1
echo 'step 1 && ck nope'\nck real-id …       before 2   after 1
```

### The single scan that closes both

`withoutComment` is **deleted**. Comment cutting, quote handling and heredoc
detection now happen in one left-to-right walk, `scanLine`, and three orderings in
it are load-bearing:

1. `<<` is read **before** quotes are emptied, or a heredoc opener would vanish
   when the line also contains a string.
2. A quoted run is emptied **unless a `ck` token immediately precedes it**, because
   here the quoted text can be the id itself (`ck_pass 'home-from-lv'`). This is
   the one place this scanner must differ from `commandSketch`'s, which empties
   every run — there the contents are argument text, here they can be the answer.
3. The comment cut happens **inside** the same walk, so a `#` inside a string is
   not a comment. Cutting comments first truncated
   `printf "a # b"; ck real-id "d" $?` at the `#` and lost the checkpoint —
   an unreported fail-open case this rewrite also closes (before 0, after 1).

The two naive variants the brief warned about were both built and both measured to
fail:

- **Anchor `HEREDOC_START` and change nothing else.** Fixes N1 (quoted `<<` → 1) but
  leaves N2 open (`printf "ok; ck phantom-id\n"` still → 2), *and* breaks real
  heredocs: anchored against the whole line, `cat <<EOF` is no longer an opener and
  the heredoc body's `ck` is counted (→ 2 where 1 is right). The anchor only works
  from inside a per-position walk, matched against `line.slice(i)`.
- **Empty every quoted run, as `commandSketch` does.** Breaks the quoted-id count:
  `GRADE_BRANCHED` drops from 3 to 2, because `ck_pass 'home-from-lv'` becomes
  `ck_pass ''`.

### N3 — fixed. The heartbeat was pinned by nothing

`TerminalDeps.heartbeatMs?: number` is now an injectable seam beside `spawnPty`,
defaulting to `HEARTBEAT_MS`. Production's 30 s is longer than any test can wait
for, which is exactly why the whole block — interval, `pong` handler, `terminate`
— deleted with the suite green. Two tests now cover both halves: a raw TCP socket
that never pongs is terminated and its pty killed, and a `ws` client that answers
survives five beats untouched.

### N4 — fixed. Nothing but grade and finish may emit a checkpoint id

The pin reads `app.routes` rather than a hard-coded list, so a route added later
is covered by construction, and it asserts the filtered route list *first* so it
cannot silently check nothing:

```
GET  /api/sessions/:id
POST /api/sessions/:id/hint
POST /api/sessions/:id/reset
```

For each: `status < 400`, and the **serialised** body contains neither
`lv-home-size` nor `fs-home-size` in exam mode.

### N5 — fixed. The known-misses list, and a warning for the other direction

The list was wrong about line continuations (a continuation is **not** a miss —
measured: `true && \` then `ck id` counts 1) and silent about `$(( x << n ))`,
which still opens a phantom heredoc named after the shift variable. Both corrected,
and the shift is pinned as a disclosed residual rather than fixed: no grader
shifts, and fixing it needs arithmetic-context tracking.

`reportFor` now warns when **more** checkpoints arrive than the script declared:

```
[grade] 3 checkpoints arrived but the script declares 2; countCheckpoints
        under-counted this grader
```

That is the only observable runtime signature of an under-count, and it is the
failure mode this guard's *own input* can have. It warns rather than failing,
because failing would fail a correct run over a bad count — the mistake the guard
exists to prevent.

### N6 — fixed. `/reset` 409s a finished session; `/hint` deliberately does not

Implemented as ruled, and **the ruling is right**, not merely followed. Verified in
the code rather than assumed: `rating` is derived at `/finish` from `s.rung` *at
that moment*, returned in the response and never stored, and `/finish` is already
409 on a second call — so no later rung can change any rating that exists or can
be re-derived. What is left after a finish is disclosure, and the mode caps are
what keep that honest: exam stops at rung 2 and drill at 3, so neither can reach
solution content post-finish. Practice reaching rung 5 right after the score is
the product working.

`/reset` is different in kind: it rewinds the guest and the rung under a session
whose `endedAt` is already set, so `endedAt - startedAt` as time spent yields a
negative number and the report describes an attempt that did not happen. The
`/grade` comment that read "409 for the same reason /hint uses it" was sharpened,
because that sentence is now the one a reader could get backwards: /hint's 409 is
the **rung cap**, not a finished session.

### N7 — fixed. The line that binds the socket

`serveOptions(fetch, port)` in `config.ts` owns `hostname: HOST`, and
`index.ts` calls `serve(serveOptions(app.fetch, PORT))`. `index.ts` cannot be
imported — it runs `loadVmConfig`, `loadBank`, `chooseTransport` and `serve` at
import time — which is why deleting `hostname: HOST` from that one line broke
nothing while the HOST test passed. The new test reads `index.ts` **as text** and
also asserts there is exactly one `serve(` call carrying arguments, so a second one
cannot appear beside it with its own options.

### N8 — folded into N1, and the comment corrected

The `<<<` branch in `commandSketch`'s `scanLine` is measured redundant: the
anchoring on `HEREDOC_START` is what refuses a herestring, and deleting the branch
leaves the herestring test passing. The old comment claimed the branch was kept
"because `<<<WORD` should not contribute `WORD` either" — **that was false**, and
measurement says the opposite: on `<<<WORD cmd` the branch *emits* `WORD`, where
falling through to `<<` emits nothing because `<WORD` is not a command shape. No
bank solution starts a line with a herestring. Comment rewritten to say what is
true: the branch is kept against a future loosening of the anchor, not for its
output.

### N9 — fixed. 028 pinned, and the `sh -c` residual disclosed

`troubleshooting/028` was the second bank sketch the round-1 quote change moved (it
lost `cat` from `nmcli … "$(cat /etc/rhcsa-conn)"`) and the only moved output that
was not pinned. Now `['systemctl', 'firewall-cmd', 'nmcli']`.

The `sh -c` residual is disclosed in `commandSketch`'s docstring:
`sudo sh -c "systemctl restart httpd"` sketches as `sh` alone. Measured
unreachable in the bank today — `grep -rnE '\b(ba)?sh[ \t]+-c' content/` returns
nothing.

### Teeth, proved by reverting

Every one of these was run, observed failing, then restored and re-verified green.

| Reverted | Test that failed |
| --- | --- |
| `session.ts` → `8083796` (round-2 scan) | `does not let a << … swallow the rest of the grader` → `expected +0 to be 1`; `does not count a ck that a string only mentions after a separator` → `expected 2 to be 1`; `warns when more checkpoints arrive …` → `warn` called 0 times |
| `CK_BEFORE_QUOTE` forced false | `keeps a quoted checkpoint id …` and `counts an id once however many branches emit it` → `expected 2 to be 3` |
| heartbeat block deleted | `terminates a socket that stops answering pings …` → `timed out waiting for the silent socket to be terminated` |
| `ws.terminate()` alone removed, interval kept | same test, same message — so the test pins `terminate`, not merely the interval |
| `ws.on('pong')` handler removed | `leaves a socket that answers its pings alone` → `expected 3 to be 1` (readyState CLOSED) |
| `result: s.result` added to `view()` | `lets no session route other than grade and finish emit a checkpoint id in exam mode` → body contains `lv-home-size` |
| `/reset`'s 409 removed | `refuses to reset a finished session …` → `expected 200 to be 409` |
| `index.ts` → inline `serve({ fetch, port })` | `is what production actually calls` → missing `serve(serveOptions(app.fetch, PORT))` |
| a second `serve({…})` added beside it | same test → `[ 'serve(s', 'serve({' ] to have a length of 1` |
| `content.ts` → `ab32303` | `pins troubleshooting/028 …` (plus the four round-1 pins) |

Two of the new counter assertions are **pins, not regressions**, and are labelled as
such in the test file rather than left to look like teeth:

- `echo hi   # heredocs use << here` already counted 1 before the fix, because the
  old scanner cut comments in a *separate earlier pass*. It is pinned because the
  new scanner does both in one walk and therefore depends on an ordering that
  nothing else asserts.
- `want=$(( 1 << shift ))` counts 0 both before and after: the disclosed residual.

### One test-harness fix found while proving teeth

With the heartbeat deleted, the terminated-socket test failed as a bare 10 s
timeout instead of its own message, because the never-closed raw socket kept
`server.close()` waiting. Both heartbeat tests now close their own socket in a
`finally`, so the failure names the missing behaviour rather than the timeout. The
`until(pred, what)` helper exists for the same reason.

### Gates

```
npm run typecheck                 exit 0
npx vitest run                    337 passed / 28 files   (round 2: 325 / 28)
node src/cli/index.ts coverage    exit 0, zero `problem:` lines
git status --porcelain            empty after commit
```

Invariants, re-measured after the rewrite — **none moved**:

```
countCheckpoints(content/lib/assert.sh) = 0
selinux/019          = 8
storage/014          = 5
systemd/017          = 5
troubleshooting/028  = 5
users/006            = 8
```

Plus 28 shape cases run against the new scan (quoted `<<`, all three heredoc forms,
herestring with and without a variable, all four separators, comments at column 0
and inline, `#` inside both quote styles, `${x#/}`, both continuation forms, the
F17 collision, the `then` miss, the shift residual) — all as expected in both
directions.

+12 tests: session 23→28, terminal 12→14, app 18→20, config 7→9, content 19→20.

No new `as` casts (src 5 / test 44, identical to `8083796`), no non-null `!`, no
`enum`, `namespace`, parameter properties or decorators. Nothing under `content/`,
`src/cli/`, `objectives.yaml`, `content/lib/assert.sh` or `package.json` was
touched; `src/engine/grading/grader.ts` untouched.

### Residuals carried forward

- `$(( x << n ))` opens a phantom heredoc in `countCheckpoints`. Pinned, disclosed,
  unreachable in the bank. Needs arithmetic-context tracking.
- `sudo sh -c "…"` sketches as `sh`. Pinned, disclosed, unreachable in the bank.
- The static id lint that would make `CK_CALL`'s permissiveness moot is Task 25's
  mandate 11, still unbuilt.

## Fix round 4

Fresh implementer, head `2cfbe8b` on `phase-0-1`. Mandate 1 was done first: the
differential oracle was built and run against the **unmodified** scanner before a
line of `session.ts` changed, and it reproduced **28 disagreements** covering all
of R1-R7 plus the `$(( ))` residual. That independently confirmed the review's
measurements and made every fix below verifiable rather than argued.

### Per-finding disposition

| # | finding | disposition |
|---|---|---|
| R1 | odd `"` parity desynchronises the walk (`indexOf` ignores `\`) | **closed.** New `closingDoubleQuote()` pairs quotes after escape removal, for double-quoted runs **only** — single quotes process no escapes, so `'it\'` stays a complete run. A bare `\x` outside quotes is also consumed, so `echo \"` opens no run and `\#` starts no comment. Both parities pinned, plus the `<<`-inside-desynchronised-string phantom heredoc (`r1-heredoc-inside-desynced-string`). |
| R2 | `CK_BEFORE_QUOTE` not word-anchored, `perm-check` reads as a `ck` token | **closed** as specified (`/(?:^|[^A-Za-z0-9_-])ck…/`, `-` inside the class on purpose). See the surviving mutant M-B below: after R3's fix, the anchor is no longer *observable*, and I am reporting that rather than claiming a test proves it. |
| R3 | the whole quoted run was kept, so `ck "real-id; ck phantom"` declared two ids | **closed.** Only the leading id-shaped prefix of the run survives (`QUOTED_ID`), which is the minimal form of the exception: an id cannot contain a space or a separator, so nothing is left inside for `CK_CALL` to find. `ck_pass 'home-from-lv'` still counts. |
| R4 | heredoc terminator matched with `trim()` | **closed.** Bash's rule: `<<` requires the line to *equal* the delimiter; `<<-` strips leading **tabs** only. All four shapes pinned (tab-indented under `<<`, trailing space, `<<-` with a tab, `<<-` with spaces). |
| R5 | only the first of several openers on a line was tracked | **closed.** `PendingHeredoc[]` queue, pushed in order, consumed in order (`cat <<A <<B`). |
| R6 | `#` starts a comment at any word start, not just after whitespace | **closed, with one correction to the review's prose.** `WORD_BREAK = /[ \t;&|()]/`. `<`/`>` are excluded because a redirect needs a target (`>#` is a syntax error — unreachable). **`}` is excluded because it is not a bash metacharacter**: measured, `{ true; }#note` is a bash *syntax error* and `${x}#tag` is a single word. Following the prose here would have introduced a new fail-open: `echo ${x}#tag; ck real-id "$y" 0` would be cut at the `#` and lose a real checkpoint. Both directions pinned, including the fail-open `true;#uses <<EOF style`. |
| `$(( ))` residual | `$(( 1 << shift ))` opened a heredoc named `shift` | **closed.** Arithmetic depth (`$((`, `((`) is tracked in the same walk and `<<` is not an opener inside it. Five arithmetic shapes pinned. The old test that pinned this at 0 was updated to 1 — the pin was a disclosure, not an invariant. |
| R7 | the known-misses list was wrong a second time (a `case` label is a *closing* paren) | **closed per the ruling.** `CK_CALL` now accepts `^` or any of `; & | { ( )`, plus an optional `then`/`do`/`else`. The list is retired; the docstring explains the widening and the fail-open/fail-closed asymmetry that justifies it. `case`, `then`, `do`, `else`, `{ }`, `( )`, `(ck …)` and a function body all measured against bash. Over-count check: `mydo ck arg-id "d" 0` still counts 0. |
| R8 | `restart()` left `s.result` intact, laundering the rating | **closed.** `restart()` now `delete s.result`, so `/finish` after a reset correctly answers its existing 409 "nothing has been graded yet" rather than rating a machine that has been wiped. Reset-to-retry still works and is pinned in the same test (regrade → finish → `rating: 'easy'` with the moved `startedAt`). |

I do not think any of the three rulings was wrong. The only place I departed from
the review text is R6's `}`, which is a measurement disagreement with the prose,
not with the ruling.

### The differential oracle

`test/server/checkpoint-oracle.ts` (helper, not collected — vitest's `include` is
`test/**/*.test.ts`) and `test/server/checkpoint-oracle.test.ts` (the gate). For
each fragment it prepends `content/lib/assert.sh`, runs it under **real bash** in a
`mkdtemp` directory under `os.tmpdir()`, and parses the JSONL ids off stdout with
`verdict.ts`'s own per-line contract. No expected number is encoded anywhere in the
table. Every case is single-path, and the docstring records that constraint and why
(`countCheckpoints` is static and counts ids on *all* paths, so a branching script
is not a valid oracle case). The test has anti-vacuity guards, because a table of
`0 == 0` rows would pass if bash or `assert.sh` went missing.

73 cases, **0 disagreements**:

| shape | bash | counter |
|---|---|---|
| `r1-escaped-quote-then-ck` | 1 | 1 |
| `r1-escaped-quote-short` | 1 | 1 |
| `r1-printf-escaped-quote` | 1 | 1 |
| `r1-bare-escaped-quote` | 1 | 1 |
| `r1-heredoc-inside-desynced-string` | 2 | 2 |
| `r1-even-parity-nested-quotes` | 1 | 1 |
| `r1-even-parity-escaped-desc` | 2 | 2 |
| `r1-single-quote-keeps-backslash` | 1 | 1 |
| `r1-single-quote-holds-escaped-double` | 1 | 1 |
| `r1-double-backslash-before-close` | 1 | 1 |
| `r2-id-ending-in-check` | 1 | 1 |
| `r2-id-ending-in-check-amp` | 1 | 1 |
| `r2-fsck-before-quote` | 1 | 1 |
| `r3-separator-inside-quoted-id` | 1 | 1 |
| `pin-quoted-id-single` | 1 | 1 |
| `pin-quoted-id-double` | 1 | 1 |
| `r4-tab-indented-eof-plain` | 1 | 1 |
| `r4-trailing-space-eof` | 1 | 1 |
| `r4-dash-tab-indented-eof` | 1 | 1 |
| `r4-dash-space-indented-eof` | 1 | 1 |
| `r5-two-openers-one-line` | 1 | 1 |
| `pin-two-heredocs-in-sequence` | 1 | 1 |
| `r6-comment-after-semicolon` | 1 | 1 |
| `r6-comment-after-close-paren` | 1 | 1 |
| `r6-comment-after-ampersand` | 1 | 1 |
| `r6-comment-after-and-and` | 1 | 1 |
| `r6-comment-after-semicolon-holds-heredoc` | 1 | 1 |
| `r6-hash-after-close-brace-is-not-a-comment` | 1 | 1 |
| `r6-parameter-strip-hash` | 1 | 1 |
| `r6-parameter-length-hash` | 1 | 1 |
| `r6-hash-mid-word` | 1 | 1 |
| `r6-escaped-hash` | 1 | 1 |
| `r6-comment-after-redirect-word` | 1 | 1 |
| `arith-shift-by-identifier` | 1 | 1 |
| `arith-shift-by-literal` | 1 | 1 |
| `arith-double-paren-shift` | 1 | 1 |
| `arith-shift-inside-quotes` | 1 | 1 |
| `arith-nested-parens-then-shift` | 1 | 1 |
| `r7-case-label` | 1 | 1 |
| `r7-after-then` | 1 | 1 |
| `r7-after-do` | 1 | 1 |
| `r7-after-else` | 1 | 1 |
| `r7-brace-group` | 1 | 1 |
| `r7-subshell` | 1 | 1 |
| `r7-subshell-no-space` | 1 | 1 |
| `r7-function-body` | 1 | 1 |
| `pin-separator-semicolon` | 1 | 1 |
| `pin-and-and` | 1 | 1 |
| `pin-or-or` | 1 | 1 |
| `pin-pipeline` | 1 | 1 |
| `pin-indented-ck` | 1 | 1 |
| `pin-two-ck-one-line` | 2 | 2 |
| `pin-all-four-helpers` | 4 | 4 |
| `pin-heredoc-quoted-delimiter` | 1 | 1 |
| `pin-heredoc-plain-delimiter` | 1 | 1 |
| `pin-heredoc-double-quoted-delimiter` | 1 | 1 |
| `pin-heredoc-opener-and-ck-same-line` | 1 | 1 |
| `pin-comment-inside-heredoc-body` | 1 | 1 |
| `pin-herestring-word` | 1 | 1 |
| `pin-herestring-variable` | 1 | 1 |
| `pin-f17-id-class-collision` | 2 | 2 |
| `pin-uppercase-id` | 1 | 1 |
| `pin-comment-line` | 1 | 1 |
| `pin-trailing-comment` | 1 | 1 |
| `pin-assert-usage-comment` | 0 | 0 |
| `pin-string-mentions-ck-after-separator` | 1 | 1 |
| `pin-string-mentions-ck-after-and` | 1 | 1 |
| `pin-hash-inside-string` | 1 | 1 |
| `pin-lt-lt-inside-double-quotes` | 1 | 1 |
| `pin-lt-lt-inside-single-quotes` | 1 | 1 |
| `pin-lt-lt-inside-comment` | 1 | 1 |
| `pin-single-quotes-inside-double` | 1 | 1 |
| `pin-double-quotes-inside-single` | 1 | 1 |

### Disagreements outside R1-R8 — the answer to question 1

Two, both found by the oracle, neither in R1-R8. They are pinned in
`ORACLE_DIVERGENCES` with their measured pair and a direction, so a future round
sees them instead of rediscovering them:

| shape | bash | counter | direction |
|---|---|---|---|
| `quoted-run-spanning-lines` | 1 | 2 | over |
| `ansi-c-quoting-with-escaped-quote` | 1 | 0 | under |

1. **A double-quoted run spanning lines** (`x="a` / `ck phantom-id "` /
   `ck real-id "d" 0`) — the scan is line-at-a-time, so the middle line reads as
   code. This is **fail-closed and loud**: `expectedTotal` lands high, `incomplete`
   fires on a correct run, the student reports a false fail. I deliberately did not
   fix it, because carrying quote state across lines trades a loud over-count for
   exactly the silent swallow-the-rest-of-the-file mode that *four* of this round's
   findings were instances of. No grader in the bank contains a multi-line string.

2. **ANSI-C quoting with an escaped quote** (`echo $'a\'b'; ck real-id "d" 0`) —
   inside `$'…'` bash *does* honour `\'`, unlike a plain single-quoted run, so the
   walk closes the run one quote early and desynchronises. This is R1 through a
   third quoting form and it is **fail-open**. It is not fixed because closing it
   properly means the walk has to know it is in an ANSI-C run, i.e. `$` lookbehind
   at every quote, and it is unreachable in the bank today: no `$'` appears in any
   grader, and the only `$'…'` anywhere in `content/` are `$'\t'`-style control
   literals with no escaped quote in them. **I am naming this an open fail-open
   risk, not a residual.**

### The six invariants, re-measured

None moved.

```
assert.sh standalone = 0
019: standalone=8  assertLib+grade=8
014: standalone=5  assertLib+grade=5
017: standalone=5  assertLib+grade=5
028: standalone=5  assertLib+grade=5
006: standalone=8  assertLib+grade=8
```

### Gates

| gate | result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npx vitest run` | **29 files, 345 tests, all passed**, nothing skipped (baseline 337/28) |
| `node src/cli/index.ts coverage` | exit 0, `problem:` lines = **0**, `untaught concepts: 0` |
| six invariants | all unmoved (above) |
| differential oracle | 73/73 agree with bash; 2 divergences pin at their measured pairs |
| new `as` casts / `!` / `enum` / `namespace` / parameter properties / decorators | **none added.** Every `as` in the diff is the English word in a comment; grepped the two new files separately since they are untracked and absent from `git diff` |
| `git status --porcelain` | empty, work committed |

### New tests: +8 (337 → 345), +1 file

- `test/server/checkpoint-oracle.test.ts` — 2 (the bash gate; the divergence pin)
- `test/server/session.test.ts` — 5 new, one per rule group (R1; R2/R3; R4/R5; R6; R7), plus the `$((` pin updated from 0 to 1 and three more arithmetic shapes added to the existing test
- `test/server/app.test.ts` — 1 new (the grade → reset → finish laundering sequence, driven through the real app with an injected clock)

### Which tests I proved by reverting my own fix

Mutation-tested in a copy under `/tmp/mut4` with `node_modules` symlinked; the repo
was never mutated.

| mutation | caught by |
|---|---|
| M-A `closingDoubleQuote(…)` → `line.indexOf(ch, i + 1)` | `session.test.ts` *does not lose a ck after an escaped quote earlier on the line*; oracle table |
| M-B `CK_BEFORE_QUOTE` word anchor removed | **survived — see below** |
| M-C id prefix → whole quoted run | `session.test.ts` *does not let a word merely ending in ck keep a quoted run, or one ck declare two ids*; oracle table |
| M-D terminator rule → `raw.trim()` | `session.test.ts` *ends a heredoc body where bash ends it, not where trim() does*; oracle table |
| M-E heredoc queue → first opener only | same test; oracle table |
| M-F `WORD_BREAK` → `/[ \t]/` | `session.test.ts` *starts a comment wherever bash starts a word, and nowhere else*; oracle table |
| M-F2 `WORD_BREAK` → `[ \t;&\|(){}]` (i.e. adding `}` as the review's prose asked) | same test; oracle table. This mutant is the reason `}` is excluded and documented |
| M-G arithmetic guard `arith === 0` → `true` | `session.test.ts` *does not let a << that is not a heredoc opener swallow the rest of the grader*; oracle table |
| M-H `CK_CALL` → the pre-round-4 pattern | `session.test.ts` *sees a ck after then, do, else, a brace group, a subshell or a case label*; oracle table |
| M-I `delete s.result` removed | `app.test.ts` *does not let a reset between grade and finish launder the rating* |

**M-B survived, and I am not papering over it.** Removing the word anchor from
`CK_BEFORE_QUOTE` breaks no test, because R3's fix makes the anchor
unobservable: the text the exception retains is `"` + an id-shaped prefix + `"`,
which contains no whitespace, and `CK_CALL` requires whitespace after `ck` before
an id — so a wrongly-triggered exception can no longer smuggle a phantom id
through. I could not construct any shape that distinguishes the two, and I checked
the routes: a retained prefix can never form a `ck<space>id` match, can never
contain a word break or a `<<`, and `CK_CALL`'s separator class requires the text
right after a separator to *start* with `ck`, which a word merely *ending* in `ck`
does not. I kept the anchor anyway — mandate 3 asks for it, it is what makes the
exception's stated intent true rather than accidentally-true, and it is one
character class. But no test proves it, and the honest statement is that R2 is
closed by R3's fix with the anchor as defence in depth.

### `src/engine/disclosure/content.ts`: deliberately left alone

R1's escape bug exists in the twin `scanLine` too. I did not touch it, and this is
a decision rather than an omission. Measured across all of `content/`: `\"` occurs
in exactly one place, `content/lib/assert.sh:16`, at even parity; the only
odd-double-quote lines anywhere are two *comment* lines in
`content/tasks/troubleshooting/028-restore-remote-access/setup.sh:41-42`, and
`commandSketch` runs over solutions, not setup scripts; and no `$'…\'…'` shape
exists in any file under `content/`. So the defect is unreachable through the
sketcher today, while the counter's copy is reachable through `assert.sh`'s own
documented usage line — which is the asymmetry that made R1 blocking there and not
here. The brief forbids merging the two scanners and asks for deliberateness
either way: this is the deliberate answer, and the divergence is now recorded in
the counter's docstring where a future round will see it.

### Correct, or merely more correct — the answer to question 2

**Merely more correct.** Every shape R1-R8 named now agrees with real bash, the
oracle covers 73 shapes including both parities and both directions of each rule,
and the four separate routes into "a phantom heredoc discards the rest of the
file" are all closed. But the scanner is still a line-at-a-time static walk of a
language whose lexer is not line-at-a-time, and I finished the round holding one
shape I believe is **wrong** and did not close:

> **Open fail-open risk:** `$'…\'…'` (ANSI-C quoting containing an escaped single
> quote) desynchronises the walk and silently loses every checkpoint after it on
> that line. bash 1, counter 0. Unreachable in the bank today; reachable the first
> time a grader author writes `$'…\'…'`.

That is the word I mean: an **open fail-open risk**, not a residual. The
line-spanning string over-count is a genuine residual, because it is loud and
because closing it would make things worse. And the reason I can say which of the
two is which is that this round measured them instead of reasoning about them —
which is the part of mandate 1 worth keeping for round 5, if there is one.

### Anything I could not do

- **M-B has no killing test** (above). Not for lack of trying; I believe none
  exists given R3's fix.
- **The two divergences are disclosed, not closed** — deliberately for the first,
  on cost grounds for the second, with the reachability measurement in both the
  code and this report.
- Nothing in the prohibitions list was needed or attempted: no VM, no `vmrun`, no
  `provision.sh`, no `ssh-keygen`, no `.env*`, no `sudo`, no subagents, no listening
  server. The oracle runs entirely in `os.tmpdir()`.

## Fix round 5

Commit `4ba3b01` on `phase-0-1`, parent `f65d0a4`. Four files:
`src/server/session.ts`, `test/server/checkpoint-oracle.ts`,
`test/server/checkpoint-oracle.test.ts`, `test/server/session.test.ts`.

### Gates, measured

| Gate | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npx vitest run` | 29 files / **349 passed**, 0 failed, 0 skipped (baseline 345/29) |
| `node src/cli/index.ts coverage` | exit 0, `0` `problem:` lines, `untaught concepts: 0` |
| `countCheckpoints(content/lib/assert.sh)` | **0** (unmoved) |
| 019 / 014 / 017 / 028 / 006 | **8 / 5 / 5 / 5 / 8**, identical standalone and as `assertLib + grade.sh` (unmoved) |
| Banned syntax on the four files | none outside comments; the 27 `as` hits are the English word |
| `git status --porcelain` | empty |

The six invariants did not move, so no grader's `expectedTotal` changed. They
cannot move: there is no `<<` opener and no multi-line quoted run in any of the
five `grade.sh` files, and `assert.sh`'s three multi-line `awk` programs happen
to close on lines with no trailing `ck` — the line-break coincidence this round
stops relying on.

### Consolidated differential battery: 27 → 8 disagreements of 38

One deduplicated battery, every case single-path, run against `f65d0a4`'s
`session.ts` and against the new one in the same process. 19 shapes fixed, 0
regressed. Fixed: the whole multi-line family (`awk`-then-`ck`-same-line, the
`is_persistent` and `within_pct` shapes copied out of `assert.sh`, single- and
double-quoted two-liners, both swallow-the-file heredoc-inside-a-run forms,
`ml-closed-on-next-line` 2 → 1), the three ANSI-C shapes, and eight of the nine
heredoc-delimiter shapes.

The 8 residuals are all pre-existing classes, now each pinned as an
`ORACLE_DIVERGENCES` entry or an accurate docstring line:

| Residual | bash | counter | Direction |
| --- | --- | --- | --- |
| `! ck id` | 1 | 0 | under |
| `LC_ALL=C ck id` | 1 | 0 | under |
| `time ck id` | 1 | 0 | under |
| `eval 'ck id …'` | 1 | 0 | under |
| `ck \` + newline + `id` | 1 | 0 | under |
| `echo {ck one,two}` + real `ck` | 1 | 2 | over |
| `sed s\|a\|ck\ phantom\|` + real `ck` | 1 | 2 | over |
| `cat <<` with no delimiter word | 0 | 1 | over |

The last one is new this round and deliberate: `cat <<` alone is a bash *syntax
error*, so bash runs nothing and emits nothing while the counter reads the
following line as code. Pinning it costs one over-count on a script that cannot
execute at all, which is the fail-closed side.

The brief predicted 33 → 18 from the reviewer's four batteries. Mine are a
different, deduplicated set, so the absolute numbers differ; the ratio and the
"0 regressed, all residuals pre-existing" finding reproduce.

### Per-mandate disposition

**1. Correct the `quoted-run-spanning-lines` disclosure (N9) — done, and superseded.**
The entry was wrong on all three counts. It is gone rather than reworded,
because mandate 2 made the shape *agree*: it is now two `ORACLE_CASES` rows
(`multiline-awk-then-ck-same-line`, `multiline-awk-is-persistent-shape`) that
prove agreement on the exact idiom `assert.sh:60` documents. The four honest
residual classes above took its place in `ORACLE_DIVERGENCES`.

**2. Land the N8 fix — done.** `scanLine` takes `carried: OpenQuote | undefined`
and returns `open`. While a run is open the line's leading part contributes no
code and — the unbounded half — registers no heredoc. Predicted failure
occurred exactly as briefed: `npx vitest run` gave 344 passed / 1 failed with
both pinned divergences now agreeing (counter 2 → 1 and 0 → 1). Both were
**converted into `ORACLE_CASES`**, not renumbered.

**3. Fix the oracle's own guards (N12) — done, with one measured refusal.**
`OracleDivergence` now carries `bashIds`/`counterIds` arrays instead of two
numbers, `OracleRow` carries `counterIds`, `measureOracle` calls the new
exported `checkpointIds`, and both lists compare id sets. Cases may override
*which* ids they declare (exactly one does, `r3-separator-inside-quoted-id`, and
says why) but the cardinality comparison stays unconditional, so an override
cannot excuse a miscount. `why.length > 80` deleted.

**Refused: "delete the direction assertion, it is a tautology that can never
fail."** I measured it. In a pristine `git archive HEAD` copy I changed exactly
one character — `direction: 'over'` → `'under'`, numbers untouched — and round
4's test **failed** at `checkpoint-oracle.test.ts:54`. It was not a tautology,
because `d.counter`/`d.bash` were the *expected* numbers that a prior assertion
had already forced to equal the measured ones. Deleting it would have removed a
live check. I fixed the real weakness instead: the direction is now derived from
the freshly measured row, so it is checked against bash rather than against the
entry's own fields, and it distinguishes `both` (equal counts, different ids) —
the compensating-pair case the old two-way form could not express.

**4. Pin M-J — done.** `subst-closing-paren-is-not-a-word-break`
(`y=$(echo a)#tag; ck real-id`, bash 1 / counter 1, 0 with tracking deleted) and
`subst-ck-inside-is-not-emitted` (`x=$(ck phantom …); ck real-id`, bash 1 /
counter 1, 2 with tracking deleted). The docstring states that suppressing `ck`
inside `$( )` is correct rather than approximate, with the reason: the JSONL goes
into the captured substitution and the harness never sees it.

**5. ANSI-C quoting — done, with a deviation the mutant proves is load-bearing.**
`closingDoubleQuote` is now `closingQuote(line, from, quote, escapes)`, used by
three call sites. **The review's prototype formula is wrong.**
`line.charAt(i - 1) === '$'` also fires on `echo \$'a\'`, where the `$` is
itself escaped and the run is a *plain* single-quoted one that `\'` does not
close — measured, that form loses the checkpoint, i.e. the prototype trades one
fail-open for another. I track a `dollar` flag through the loop instead, reset at
the top of every iteration and set only by the plain-text branch. Mutant M-M2
(the prototype form) is killed by `ansi-c-escaped-dollar-is-not-ansi-c`. The
`'it\'` asymmetry is intact and pinned by `r1-single-quote-keeps-backslash`.

**6. `HEREDOC_START` — widened, not disclosed.** Reason: three of the six shapes
are silent fail-opens that discard the rest of the grader, every shape is
measurable against real bash so the fix is verifiable rather than reasoned, and
there is no `<<` opener anywhere in the counted text — so the invariants
provably cannot move and the change is verifiable-but-unreachable, the cheapest
class of fix to land on a final round. `HEREDOC_START` is replaced by
`heredocDelimiter(slice)`, which reads a bash **word**: backslash quotes one
character, quoted segments contribute their contents, and the word ends at
`WORD_END`. `WORD_END` deliberately differs from `WORD_BREAK` by `<` and `>`
only, with a docstring saying why unifying them would re-open R6. All six broken
shapes plus `<<-END-OF-MSG`, `<< EOF` and `<<EOF>/dev/null` now agree.

> **Corrected in round 6 (F3).** The reasoning above treats widening the delimiter
> parser as safe because the invariants cannot move. The invariants indeed did not
> move, but the implied safety claim — that widening could only push shapes in the
> fail-closed direction — is false. Measured: `echo $[1 << 2]` agreed at `f65d0a4`
> and *under*-counts at `4ba3b01`, because the `arith === 0` guard recognises `$((`
> and `((` but not bash's deprecated `$[ … ]`, so `2]` is read as a delimiter and
> the rest of the file is discarded. Now disclosed as
> `deprecated-arith-read-as-heredoc`; not fixed, because round 6's exception covers
> two named regressions only.

**7. N13/N14 — done, with corrected numbers.** N13's five shapes and N14's brace
list are now four `ORACLE_DIVERGENCES` entries carrying exact id sets, not prose.
**The brief's N14 numbers are wrong:** `echo {ck one,two}` alone measures bash 0
/ counter 1, not "2 vs 1"; the 1 vs 2 reading needs a second line with a real
`ck`. Direction (fail-closed) is right. I pinned the accurate two-line form.
**M-B untouched.**

### Mutation testing

Tree copied to `/tmp/r5` with `node_modules` symlinked back; the real repo never
ran a mutant. 10 new mutants, all killed: M-L/M-L2 (drop the carried state; drop
only the heredoc suppression), M-M/M-M2 (drop `ansiC`; the review's prototype
formula), M-N/M-N2 (restore the narrow `HEREDOC_START`; drop `<>` from
`WORD_END`), M-J, M-O (compensating pair — **killed by the new id-set gate and
survives the old cardinality one**, which is the demonstration that mandate 3
bought something), M-P, M-Q. All 8 round-4 mutants (M-A, M-C, M-D, M-E, M-F,
M-F2, M-G, M-K) still die.

> **Corrected in round 6 (F6).** The three sentences above name M-O, M-P and M-Q
> by *effect* rather than by edit, which makes them unauditable — the same
> category of unfalsifiable evidence this task's whole discipline is against, and
> the re-reviewer had to reconstruct M-O itself to check the claim. The edits,
> re-derived and re-measured in round 6:
>
> - **M-O** — `src/server/session.ts`, in `checkpointIds`:
>   `ids.add(id)` → `ids.add(ids.size === 0 ? 'zz-phantom' : id)`. Loses one real
>   id and gains one phantom on every input, leaving cardinality identical.
>   Measured: id-set gate **red** (both oracle tests), gate reverted to the
>   `f65d0a4` cardinality form **green (2/2)**. The claim holds.
> - **M-P** — `test/server/checkpoint-oracle.ts`, on `brace-list-containing-ck`:
>   `direction: 'over'` → `direction: 'under'`, nothing else touched. Measured:
>   red, `AssertionError: expected 'under' to be 'over'`.
> - **M-Q** — `test/server/checkpoint-oracle.ts`, on `multiline-single-quoted`:
>   add `counterIds: []` to the row. Measured: red, naming the row —
>   `multiline-single-quoted: bash 1 (real-id), counter 1 (real-id)`. So the
>   escape hatch is validated against the measured counter rather than trusted.

M-N2 initially **survived**: my first pin `cat <<EOF >/dev/null` has a space, so
the space already ended the word and the pin did not discriminate `WORD_END`
with `<>` from without. I measured the tight form against bash (it names `EOF`
and redirects the body), then added `hd-delim-tight-redirect` and a matching
unit assertion. This is the one finding of the round that existed only because
the brief required mutating my own new pins.

### Question 1: did any mandate turn out to be wrong?

Two, both refused with a measurement, both documented above:

- **Mandate 3's "delete the tautology."** Not a tautology; flipping only
  `direction` at HEAD fails the test. Deleting it would have removed a live
  check. Re-sourced from the measured row instead — strictly stronger, and it
  also kills M-P.
- **Mandate 5's prototype formula.** `charAt(i - 1) === '$'` regresses
  `echo \$'a\'` into a fresh fail-open. Tracked `$` state instead; M-M2 proves
  the deviation is load-bearing rather than gold-plating.

And one factual correction: **mandate 7's N14 numbers**, above. Nothing in the
reversal of round 4's multi-line ruling was wrong — I reproduced all four of the
brief's measurements independently at `f65d0a4` before writing any code.

### Question 2: correct, or merely more correct?

**Merely more correct**, and the honest form of that answer has changed shape.
Round 4's answer was "a line-at-a-time static walk of a language whose lexer is
not line-at-a-time." That specific gap is now closed for quoted runs: the walk
carries lexical state across the newline, which is why 19 shapes moved. What is
left is not a line-at-a-time problem, it is that `CK_CALL` decides where a
command may start from a fixed anchor set `^` or `[;&|{()]`, and bash decides it
from a grammar.

> **Corrected in round 6 (F7).** The next sentence's cost claim is wrong and it is
> the sentence a future round would act on. Measured by the re-reviewer and not
> disputed: adding `!` to `CK_CALL`'s anchor class (`[;&|{()]` → `[;&|{()!]`) is one
> character and closes **`! ck` only**, with zero collateral across three
> batteries. `VAR=x ck`, `time ck` and `eval 'ck …'` need real bash command-prefix
> modelling and are untouched by it. So: **three fail-opens, of which one closes
> for one character.** The shipped disclosure text in `checkpoint-oracle.ts` was
> already accurate; only this summary was not.

**The residual I would fix first in a round 6: the command-prefix family**
(`! ck`, `VAR=x ck`, `time ck`) — three fail-opens, one regex change, and unlike
`eval` or `{ }` brace expansion it needs no new machinery. It is unreachable in
today's five graders, but `! ck` is a plausible thing for a grader author to
write, and it fails in the silent direction. I did not land it this round
because the brief ranked it as a disclosure and a final round is the wrong place
to widen an anchor set on an unbudgeted mandate: widening `^|[;&|{()]` is
exactly the move that produced R2 and R3.

The deeper residual is the one the brief parked: this is ~190 lines of
hand-rolled lexer with six historical defects and a divergent twin in
`src/engine/disclosure/content.ts` that still carries R1's escape bug. I agree
with parking the extraction and I agree with the reason.

### Question 3: which of my changes is most likely to be the seventh defect?

**The carried-quote handoff in `scanLine`'s prologue — specifically `code =
carried.quote + carried.quote`.** Everything else this round is local; this one
line reaches across a line boundary and synthesises text that was never in the
script. It exists so the closing line's remainder is separated from whatever
preceded it, but it means the emitted `code` for a continuation line is not a
substring of the input. If a future change makes anything downstream of `code`
positional — a column number in an error message, a slice, an offset into the
original script — it will be silently wrong, and the id sets will still match so
neither the oracle nor the invariants would see it.

The second candidate is narrower and worth naming: `heredocDelimiter` returns
`undefined` for an unclosed quote inside the delimiter word
(`cat <<'EOF` with no closing quote). Real bash keeps reading the next line as
part of that word. I chose `undefined` — no heredoc opened — which is the
fail-**closed** direction for the body but means the body's lines are scanned as
code. It is unreachable and untested against bash because the shape is a
multi-line delimiter word, which I could not construct as a single-path oracle
case.

**What would catch either:** a property test over the differential oracle rather
than a table — generate lines from the grammar the cases were hand-written from
(quotes, `$'`, `$(`, heredoc openers, comments, `ck` calls at every anchor
position), run real bash, compare id **sets**. The reviewer already built exactly
this instrument for M-B and pushed 419,328 lines through it; pointed at
`checkpointIds` instead of at one regex, it is the thing that would have found
all six historical defects without six rounds. That is the single highest-value
follow-up on this function, and it is a test-only change with nothing under it to
break.

### Concerns

1. `checkpointIds` is exported and nothing outside the tests calls it. It is the
   right seam for the property test above, but until that exists it is public
   surface with one consumer.
2. `WORD_END` and `WORD_BREAK` are two similar regexes that differ by two
   characters for a documented reason. The docstring says why; a future editor
   who unifies them re-opens R6, and only the oracle would catch it.
3. `cat <<` with no delimiter is now a pinned over-count. Correct on the
   fail-closed side, but it is the one place this round moved a shape *away* from
   bash rather than toward it, and it should be read as a deliberate choice.
4. The multi-line ANSI-C case `x=$'a\'` + newline + `b'` is pinned by
   `ansi-c-spanning-lines`, but the `ansiC` bit surviving the newline is only
   exercised by that one row. It is the least-covered piece of new state.

### Addendum: mandate 4's `printf` probe artifact — verified clean, no change required

The lead warned after delivery not to copy the round-4 reviewer's
`ck-inside-cmdsubst` probe verbatim, because that probe's `bash=1` depends on it
**re-emitting with `printf`**, which the real harness does not do.

I built both rows from the natural shapes in mandate 4, so neither carries the
artifact. `grep -n printf test/server/checkpoint-oracle.ts` returns six hits,
all unrelated (`r1-printf-escaped-quote`, `pin-pipeline`, and two comment-parser
rows); neither M-J row is among them. As committed:

```
subst-closing-paren-is-not-a-word-break   y=$(echo a)#tag; ck real-id "$y" 0
subst-ck-inside-is-not-emitted            x=$(ck phantom "d" 0)
                                          ck real-id "d" 0
```

Measured directly, `assert.sh` prepended, raw visible stdout, no re-emission:

| Row | bash's visible stdout | bash ids | `checkpointIds` |
| --- | --- | --- | --- |
| 1 | `{"id":"real-id","desc":"a#tag","status":"pass"}` | `["real-id"]` | `["real-id"]` |
| 2 | `{"id":"real-id","desc":"d","status":"pass"}` | `["real-id"]` | `["real-id"]` |

Row 2's inner `ck` **did** run — appending `echo "captured into x: [$x]"` prints
`captured into x: [{"id":"phantom","desc":"d","status":"pass"}]`. Its JSONL went
into the variable and never reached the stream the harness reads. That is the
positive evidence that counter 0 for a captured `ck` is *correct rather than
approximate*, which is what the docstring already claims. Neither row has a
`counterIds` override, so each asserts equality with bash's measured set.

M-J re-verified on these exact natural shapes in a fresh `git archive HEAD` copy
with the `$( )` tracking and its `subst` counter deleted outright: row 1 → `[]`
(0 vs bash 1, fail-open), row 2 → `["phantom","real-id"]` (2 vs bash 1,
fail-closed). Killed by **both** instruments independently — the oracle gate
prints both rows by name, and `session.test.ts:197` fails on row 2. The real repo
never ran the mutant and is clean at `4ba3b01`.

## Fix round 6 (breaker exception)

Commit `28ad7f0` on `phase-0-1`, parent `4ba3b01`. Three files:
`src/server/session.ts` (two edits plus two docstrings),
`test/server/checkpoint-oracle.ts` (18 rows, 3 divergences, 1 prose fix),
`test/server/session.test.ts` (2 tests). **Not reverted** — the stopping rule was
not triggered: no invariant moved and no battery case regressed.

### Gates, measured

| Gate | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npx vitest run` | 29 files / **351 passed**, 0 failed, 0 skipped (baseline 349) |
| `node src/cli/index.ts coverage` | exit 0, `0` `problem:` lines, `untaught concepts: 0` |
| Six invariants | `assert.sh` 0; 019=8, 014=5, 017=5, 028=5, 006=8 — standalone **and** as `assertLib + grade.sh`. **Unmoved.** |
| Battery | **23 → 12** disagreements of 62: **11 closed, 0 new** |
| Banned syntax | none outside comments in the three files |
| `git status --porcelain` | empty |

No test went red at any point, so no divergence pin needed promoting. That is
itself the review's F1 observation confirmed: the suite could not tell either
defect from its fix, which is why mandate 3's rows had to exist.

### Battery: 23 → 12 of 62

Same consolidated single-path battery as round 5, extended from 38 to 62 cases
with the review's H- and A-families, four F1 controls, two F2 controls, the three
F3/F4/F5 shapes and three arithmetic/herestring controls. Both runs in one
process against the same `assert.sh`.

**Closed (11):** H1, H2, H3, H4, H5, H9 (all `bash [1 or 2] / counter []` before,
agreeing after) and A1, A3, A4, A5 (same) plus **A6**, the pre-existing
over-count, `bash [] / counter [real-id]` → both empty. One condition closed four
under-counts and one over-count.

**Residual (12), every one disclosed:** `hd-bare-no-word` (round 5's deliberate
over-count on a script that is a bash syntax error), the five N13 command-prefix
shapes, `res-brace-list`, `res-sed-delimiter`, and the three new disclosures
F3/F4/F5 (F5 as two shapes). No case moved from agree to disagree.

All ten controls agree before and after, including `carried-sq-keeps-backslash`
and `carried-ansi-c-escaped-quote` — the two that bound the fix on either side.

### Per-mandate disposition

**1. F1, one token — done.** `session.ts:286` now reads
`closingQuote(line, 0, carried.quote, carried.quote === '"' || carried.ansiC)`,
which is how the main-loop site at `:375` has always computed it. The comment
above it names the defect as R1 through the newline. `echo 'it\'` still agrees
(`r1-single-quote-keeps-backslash`, unchanged), and the asymmetry is now pinned
*across* the newline too by `carried-sq-keeps-backslash`, which is why the fix
tests the quote character rather than passing `true` — mutant M-T below.

**2. F2, one condition plus the false docstring — done, and I re-measured the
premise before touching it.** The guard is now
`if (open !== undefined && quoted === undefined)`. I did not take the review's
word for the ordering, because I wrote the sentence it contradicts. Measured
directly, `assert.sh` prepended, on the docstring's own example:

```
cat <<EOF; x="a
ck inside "d" 0
b"
EOF
ck real-id "d" 0
```

bash's visible stdout is `{"id":"real-id","desc":"d","status":"pass"}` and nothing
else — no `inside`. Appending `printf "x=[%s]\n" "$x"` prints
`x=[a⏎ck inside d 0⏎b]`, which is the decisive part: it shows *which lines went
into the word*. bash completed the unterminated quoted word across two newlines
first, and only then gathered the heredoc body — which by then began at `EOF` and
was empty. **My docstring had it exactly backwards**, and the docstring now
records the measurement, including the `$x` contents, rather than a claim.

**3. Promote the closed shapes — done, 18 rows.** Six H-family rows, five
A-family rows (A6 labelled as the fail-*closed* member the same condition
closed), and seven controls, in two labelled groups with the direction and the
one-line student-visible consequence stated. Plus two unit tests in
`session.test.ts` covering the same ground without spawning bash, so each edit is
caught by two independent instruments as in round 5.

**4. Three disclosures, no fixes — done.**
`deprecated-arith-read-as-heredoc` (F3, `under`, `bashIds: ['real-id']`,
`counterIds: []`) states plainly that it **refutes round 5's argument that
widening the delimiter parser could only fail closed**, and names the reason: the
`arith === 0` guard covers `$((` and `((`, not `$[ … ]`.
`subst-depth-resets-across-newline` (F4, `over`) states that `subst`/`arith` are
`scanLine` locals while `quoted` survives the newline — two pieces of lexical
state with different lifetimes — and that giving them one lifetime is exactly the
change this round is not permitted to make. `continuation-glues-word-onto-ck`
(F5, `over`, pre-existing) is split out as its own entry rather than folded in,
because its direction is the opposite of the entry that used to mis-describe it.

**F5's prose fix:** `continuation-between-ck-and-id`'s `why` claimed "A
continuation *before* the `ck` counts correctly". Corrected to what is measured —
it counts correctly only when it ends a complete word (`: \` and
`test -f /etc/hosts \` both agree, verified), and does not when it glues the
previous word onto `ck`. The anchor claim about the bank is now stated as all ten
trailing-`\` lines falling after a `ck` id.

**5. The two reporting defects — corrected in place, with markers.** Both fixes
are block quotes inserted at the offending sentences in the round-5 section, so a
future round reading that sentence sees the correction rather than having to find
this section.

- **F6.** M-O, M-P and M-Q were named by effect. I re-derived all three as stated
  edits and re-measured them rather than reconstructing from memory:

  | Mutant | Edit | Measured |
  | --- | --- | --- |
  | M-O | `session.ts`, `checkpointIds`: `ids.add(id)` → `ids.add(ids.size === 0 ? 'zz-phantom' : id)` | id-set gate **red** (both oracle tests); same mutant with the gate reverted to `f65d0a4`'s cardinality form **green 2/2** |
  | M-P | `checkpoint-oracle.ts`, `brace-list-containing-ck`: `direction: 'over'` → `'under'` | **red**, `expected 'under' to be 'over'` |
  | M-Q | `checkpoint-oracle.ts`, `multiline-single-quoted`: add `counterIds: []` | **red**, naming the row: `bash 1 (real-id), counter 1 (real-id)` |

  M-O's discriminating claim therefore holds under a written-down edit, which is
  what it did not have before.

- **F7.** The "three fail-opens, one regex change" sentence is corrected to
  **three fail-opens, of which one closes for one character** — adding `!` to
  `CK_CALL`'s anchor class closes `! ck` only; `VAR=x ck`, `time ck` and
  `eval 'ck …'` need real command-prefix modelling.

### Mutation testing the two new pins

Working tree (not `HEAD`) copied via `git ls-files -z | tar` to `/tmp/f6/r6` with
`node_modules` symlinked back; copy verified green 41/41 first, restored and
re-verified green after. The real repo never ran a mutant —
`git status --porcelain` showed only my three intended modifications throughout.
Each edit is stated, per F6's lesson:

| Mutant | Edit | Result |
| --- | --- | --- |
| **M-R** | `session.ts`: `carried.quote, carried.quote === '"' \|\| carried.ansiC)` → `carried.quote, carried.ansiC)` (F1 reverted) | **killed**, both instruments. Oracle names all six: `carried-dq-escaped-quote`, `-then-ck-same-line`, `-then-ck-next-line`, `-grep-shape`, `-three-lines`, `-then-heredoc` |
| **M-S** | `session.ts`: `if (open !== undefined && quoted === undefined) {` → `if (open !== undefined) {` (F2 reverted) | **killed**, both instruments. Oracle names all five: the four `heredoc-opener-with-open-*` rows and `heredoc-delimiter-swallowed-by-open-quote` |
| **M-T** | `session.ts`: `carried.quote, carried.quote === '"' \|\| carried.ansiC)` → `carried.quote, true)` (F1 over-corrected) | **killed**, both instruments — so the fix being a quote-character test rather than `true` is load-bearing, not decoration |

My first M-R attempt was not a faithful revert (it altered the `quote` argument as
well as `escapes`). It died, but for a reason that partly overlapped the intended
one, so I discarded it and re-ran the literal single-token revert above. Same
class of error as round 5's spaced `<<EOF >/dev/null` pin, caught the same way.

### Question 1: do I disagree with either edit?

**No, and I checked the one I had reason to doubt.** F2 contradicts a docstring I
wrote, so I re-measured it from scratch before editing and the measurement is
unambiguous: `$x` holds `a⏎ck inside d 0⏎b`, so bash absorbed both following lines
into the quoted word and the heredoc body began afterward. My round-5 reasoning
was backwards, and the review is right. F1 needed no adjudication — it is a
disagreement between two call sites of one helper, and the main-loop site is
demonstrably the correct one.

The one thing I would flag as a *judgement* rather than a fact: F2's condition
gives a carried quoted run precedence unconditionally. That is right for the
shapes measured here, but it is a rule about which of two multi-line constructs
wins, decided from five shapes. If a grader ever nests them the other way round —
a heredoc body that itself contains an unterminated quote — nothing in the table
covers it, because I could not construct that as a single-path case (`quoted` is
never set while a body is pending, so the shape does not arise through this code
path today).

### Question 2: highest-severity thing still wrong, one item

**`! ck` and the command-prefix family — `CK_CALL`'s anchor set, direction
silent fail-open.** Unchanged from round 5's answer, and now with a measured cost
that is *smaller* than I reported: one character (`[;&|{()]` → `[;&|{()!]`) closes
`! ck` with zero collateral across three batteries, per the re-review. `! ck` is
an entirely plausible thing for a grader author to write, and it loses the
checkpoint silently, which is the direction that tells a student who changed
nothing that the lab passed. It is out of scope here by ruling — inherited debt,
not this round's regression — and it should be the first thing any future work on
this function does.

Second, and the reason I named it in the docstring rather than only here: the
lexical-state lifetime split (F4). `quoted` crosses the newline; `subst` and
`arith` do not. That is now a documented internal inconsistency in a function
whose defects have all come from partial models of bash's lexer, and it is the
seam the next defect is most likely to arrive through.

### Concerns

1. **The two edits are correct; the process that produced round 5 is the finding.**
   Both regressions were introduced by one round, invisible to 349 tests, and
   found by reading the diff and asking which argument crosses the newline — not
   by any instrument. The re-reviewer's fuzzer did not find them either. The
   oracle table only catches shapes someone thought to write down, and both of
   these were written down only after the defect was known.
2. **F1 was a drift defect between two call sites of one helper.** I have now
   made them agree by duplicating the expression rather than by extracting it,
   because extraction is parked by ruling. The duplication is two tokens and
   commented, but it is the same shape of latent bug the round-5 fix was.
   `closingQuote`'s callers should compute `escapes` in one place.
3. **A6 changed direction, from over to under-and-correct.** `cat <<EOF; x="a` /
   `EOF` / `b"` now counts 0, matching bash, because bash never terminates the
   body and emits nothing. That is right, but it means the counter and bash now
   agree on a script that is *broken* — a grader written that way silently grades
   nothing, and neither `expectedTotal` nor `incomplete` can distinguish it from
   a grader with no checkpoints. Nothing in this task's scope detects a grader
   that emits nothing by accident.
4. **Three new divergences is the most this list has held.** Seven entries now.
   Each is measured and directional, but a disclosure list that grows every round
   is a list on its way to being unread, and two of the three additions (F3, F4)
   are consequences of round 5's own widening rather than inherited debt.
5. **The `$[ ]` disclosure is unreachable-by-deprecation, not by absence.** It is
   absent from `content/` today; it is also valid bash that still works. The
   `arith` guard is one alternation away from covering it and I left it alone
   because the exception was for two named regressions. That is the correct
   reading of the brief and it is also a fail-open left open on purpose.
