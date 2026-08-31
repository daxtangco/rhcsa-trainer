# Task 23 — mandated changes to the brief

Ten **required** changes — 1 through 9 plus the addendum numbered 10 at the end of
this file, which was found during the Task 24 pre-flight and is easy to miss
because it sits below the "Verify before committing" section. They override
`task-23-brief.md` wherever they
conflict; everything else in the brief stands — the four-file server layout, the
`LabRuntime` seam, the `PtyLike` interface and the `ssh -tt` pipe (no native PTY),
the masking design (grading is repeatable and masked, finishing unmasks), the
revert-then-setup ordering, the deliberate refusal to roll the rung back on
`/reset`, and the commit message.

**Read the measurement warning first, because it got worse since this file was
written.** Task 22 produced **four** wrong claims of mine in one task: a mandate
that told its implementer the grader's `date -u` was load-bearing when the `-u`
was the bug (it would have failed four of six fixtures), two stale test-count
numbers, and — the one that matters most here — a rationale I *endorsed* rather
than measured, for a failure mode that could not occur. All four were caught by
reviewers, none by me. The tally in this file's earlier drafts was too generous.

So the rule, and it binds me before it binds you: **a claim below is only as good
as the label on it.** I have gone back and marked each one `COMMAND` (I ran it and
pasted output), `READ` (I quote a file by line), or `TRACED` (I executed the logic
in my head — the weakest kind, and the kind that was wrong in Task 22).
**Confirm anything you depend on with your own command, whatever the label. If
your measurement disagrees with mine, yours wins — say so in the report and act
on yours.** No item below carries an instruction to stop looking; the earlier
draft's "do not spend a review finding on these" is withdrawn, because that
sentence is exactly what let Task 22's F1 through.

This task is where the project stops being a library and starts being a thing
the user touches. Two of the mandates below (2 and 7) are the first
security-and-correctness holes in the project that a student could hit without
doing anything unusual.

---

## Checked and believed fine — with the strength of each check named

I suspected each of these and checked it. **Two of the eleven are `TRACED`, which
means I executed the logic by hand and nothing verified me. Those two are the most
likely items on this page to be wrong: they are the same kind of claim that was
wrong in Task 22.** Re-run any of these that your work depends on.

- `TRACED` — **`deriveRating` really does return `'hard'`** for the exam test's
  inputs. I traced `src/engine/disclosure/ladder.ts`'s cascade with `rungUsed: 1`,
  `passed: false`, `anyPassed: true`, `hadRegression: false`: `hadRegression` no,
  `rungUsed >= 4` no, `!passed && !anyPassed` no, `!passed` **yes → 'hard'**. The
  brief's `expect(done.rating).toBe('hard')` is correct. Do not change it.
- `READ` — **`advance()` throws `` `rung ${rung} is the maximum in ${mode} mode` ``**
  (`ladder.ts`), so both `/maximum in exam mode/` assertions match the real
  message. `SessionStore.advanceRung` relying on that throw instead of calling
  `canAdvance` is fine.
- `READ` — **`loadTaskScripts(task: TaskSpec, assertLib: string)`** is exactly the
  signature `AppDeps.loadScripts` declares (`src/engine/validate/harness.ts:42`).
  `loadScripts: loadTaskScripts` in `index.ts` typechecks as written.
- `READ` — **The test's `bank()` helper matches the real interfaces.** `Bank`
  (`bank.ts:9-16`) is `{root, objectives, tasks, concepts, tasksById,
  conceptsById}`; `ObjectiveSet` (`objectives.ts:11-16`) is `{version, source,
  objectives, byId}`; `Objective` (`objectives.ts:5-9`) is `{id, text, chapters}`.
  All three match. Leave the helper as written.
- `READ` — **`finalVerdict(r: GradeResult): Verdict` exists** at
  `src/engine/grading/grader.ts:65` and `GradeResult` is
  `{verdictA, verdictB?, regressions, rebooted, rebootError?}` (`grader.ts:14-25`),
  so the tests' three-field `result()` helper is valid.
- `COMMAND` — **Node on this host is v22.23.2**, so `--env-file-if-exists` is supported (it
  landed in 22.9). The `dev:server` script is correct as written, and the reason
  the brief gives for preferring it over `--env-file` is sound.
- `COMMAND` — **The brief's `sshArgs` option list is byte-identical, in the same order, to
  `SshTransport.#args()`'s inline list** — BatchMode, StrictHostKeyChecking,
  UserKnownHostsFile, ConnectTimeout=10, LogLevel=ERROR, `-i`, `-p`, `user@ip`.
  I diffed them. So the refactor genuinely is argv-preserving and
  `test/vm/ssh.test.ts`'s argv assertions will pass. **See mandate 1 for the part
  of that refactor that is not safe.**
- `TRACED` — **`countCheckpoints`'s regex is right on both fixtures.** Traced: `GRADE` →
  `ck lv-home-size`, `  ck fs-home-size`, and `# ck not-a-real-one` excluded by
  the `^[ \t]*ck` anchor = **2**. `GRADE_BRANCHED` → `lv-home-size` (twice),
  `home-from-lv` (quoted), `fs-home-size` (twice) = **3** distinct. Both
  expectations are correct.
- `COMMAND` — **`content/lib/assert.sh` contains no line matching `CK_CALL` today**:
  ```
  $ grep -nE '^[ \t]*ck(_pass|_fail|_skip)?[ \t]+["'"'"']?[a-z0-9]' content/lib/assert.sh
  (none)
  ```
  So counting over the concatenated string is correct today. **Mandate 6 is about
  keeping it that way**, not about a live miscount.
- `READ` — **The per-step test counts are right.** I counted the `it` blocks: 8 in
  `content.test.ts` (3 sketch + 5 rung), 14 in `session.test.ts` (2 + 2 + 5 + 5),
  15 in `app.test.ts` (1 + 2 + 3 + 3 + 2 + 3 + 1), 6 in `terminal.test.ts`. Steps
  5, 9, 14 and 18 each state the right number. **Report the totals you observe
  anyway** — Tasks 21 and 22 are landing tests around you.

---

## 1. The `sshArgs` refactor as briefed deletes a guard, and cannot compile where it is placed

Three separate problems in one twelve-line snippet. All three are in Step 17's
"one small addition to Task 17's `config.ts`".

**(a) `cfg.ip ?? ''` deletes the error the transport exists to give.**
`SshTransport.#args()` opens with:

```ts
    if (!this.#cfg.ip) {
      throw new Error(
        'SshTransport has no IP. Set RHCSA_VM_IP in .env.local, or let the vmrun ' +
          'transport handle it.',
      )
    }
```

The brief's replacement builds `` `${cfg.sshUser}@${cfg.ip ?? ''}` `` instead, so
a missing IP becomes `ssh ... student@` — a connection attempt to the empty
hostname, and a message that names neither `RHCSA_VM_IP` nor `.env.local`. There
is an existing test on exactly this:

```
test/vm/ssh.test.ts:98:  it('exec throws a legible error with no IP', async () => {
test/vm/ssh.test.ts:100:    await expect(t.exec('true')).rejects.toThrow(/no IP/)
```

**The brief mispredicts this failure.** It says "its existing tests assert on the
produced argv, so they must keep passing unchanged — if they do not, the two
lists had already drifted and the tests are the record of which one was right."
I diffed the two option lists and **they are identical**, so drift is not a
possible explanation: the only way that suite fails is by dropping the guard.
Do not edit `test/vm/ssh.test.ts`. Keep the guard, and put it inside `sshArgs`
so the terminal bridge gets it too — a terminal that silently dials `student@`
is worse than one that says why it can't.

**(b) `sshArgs(cfg: VmConfig)` cannot be called by `SshTransport`.** The
transport deliberately holds the narrower `SshConfigSlice` (`ssh.ts`), not
`VmConfig`. A parameter typed `VmConfig` rejects it.

**(c) Putting `sshArgs` in `config.ts` is circular.** It would need
`SshConfigSlice` from `ssh.ts`, and `ssh.ts` would need `sshArgs` from
`config.ts`. It also duplicates `join(homedir(), '.ssh', 'rhcsa_known_hosts')`,
which already exists in `ssh.ts` as `KNOWN_HOSTS` with a long comment explaining
why the file is separate.

**Required:** define `sshArgs` in **`src/engine/vm/ssh.ts`**, typed
`sshArgs(cfg: SshConfigSlice): string[]`, reusing `KNOWN_HOSTS`, keeping the
no-IP throw, and **not** including `'bash -s'`. `SshTransport.#args()` becomes
`[...sshArgs(this.#cfg), 'bash -s']`. `terminal.ts` imports `sshArgs` from
`../engine/vm/ssh.ts` and appends `'-tt'` and the remote command.
`VmConfig` is structurally assignable to `SshConfigSlice`, so
`spawnSshPipe(cfg: VmConfig, ...)` can pass it straight through. `config.ts` is
not modified by this task at all.

Run `npx vitest run test/vm/ssh.test.ts` before and after and paste both.

## 2. The terminal hands out a sudo-capable shell to the whole network, and to any web page

`/ws/terminal` spawns `ssh -tt` into the guest as `student`, and `student` has
**passwordless sudo** (`/etc/sudoers.d/rhcsa-trainer`, arranged by
`guest-provision.sh`). So that endpoint is a root shell in the lab VM with no
authentication in front of it. Two independent exposures, both one line to close:

**(a) The listener binds every interface.** `serve({ fetch: app.fetch, port: PORT })`
does not pass `hostname`, so anything that can route to this machine — every
other device on the user's network, and every VM on it — can open that socket.
This is a single-user local trainer (spec section 1). Bind it explicitly:

```ts
const server = serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' })
```

I could not measure `@hono/node-server`'s default (it is not installed on this
host yet — Step 1 installs it). **That does not matter**: passing `hostname`
explicitly is correct whichever way the default goes, and it documents the
intent. Verify after installing which it was, and say so in the report.

**(b) Nothing checks `Origin` on the upgrade.** WebSocket connections are not
subject to the same-origin policy, and browsers happily let a page at
`https://anywhere.example` open `ws://localhost:5175/ws/terminal`. Binding to
loopback does **not** close this: the request originates from the user's own
browser, on loopback. Add an origin check in the `upgrade` handler, beside the
existing pathname check, and destroy the socket on a mismatch:

```ts
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    // A WebSocket upgrade is not subject to the same-origin policy, so without
    // this any page the user visits could open an interactive shell in the lab
    // VM - where `student` has passwordless sudo. Loopback binding does not help
    // here: the request comes from the user's own browser.
    const origin = req.headers.origin
    if (origin !== undefined && !ALLOWED_ORIGINS.has(origin)) {
      socket.destroy()
      return
    }
    if (url.pathname !== '/ws/terminal') {
      socket.destroy()
      return
    }
    ...
```

`ALLOWED_ORIGINS` is `http://localhost:${PORT}` and `http://127.0.0.1:${PORT}`
plus the Vite dev origin Task 24 will serve from — pass the allowed set into
`TerminalDeps` rather than hardcoding it in `terminal.ts`, so the test can
exercise both arms. Allowing a **missing** `Origin` header is deliberate: a
non-browser client such as `wscat` (Step 20's acceptance) sends none, and a
browser always does. Say that in a comment, because it is the one part of this
that looks like a hole and isn't.

**Add two tests**: an upgrade with a foreign `Origin` is destroyed and no pty is
spawned; an upgrade with an allowed origin (and one with no origin at all)
proceeds. `TerminalDeps.spawnPty` already exists as the injection point, so
"was a pty spawned" is observable without a subprocess.

## 3. Seven new `as` casts — `src/` has six in total

`COMMAND`, re-run at dispatch time and still exact — five lines, six casts:

```
$ grep -rnE "\bas ([A-Z]|unknown|const\b)" src/ | grep -v "as const"
src/engine/vm/config.ts:54:    forceTransport: forced as TransportKind | undefined,
src/engine/content/task.ts:96:  const scope = SCOPES.includes(raw.scope as string) ? (raw.scope as TaskScope) : 'exam-objective'
src/engine/content/task.ts:101:  const weight = WEIGHTS.includes(raw.weight as string) ? (raw.weight as TaskWeight) : 'medium'
src/engine/content/task.ts:108:    ? (rawTransport as TaskTransport)
src/engine/grading/verdict.ts:29:  const cp: Checkpoint = { id: v.id, desc: v.desc, status: v.status as CheckpointStatus }
```

Every one of them is a guarded-union idiom parked in the ledger for a single sweep
behind one `oneOf` predicate helper. **Do not touch those five lines** — they
belong to closed tasks. But the global constraint is "no `as` casts", and the
brief adds seven more sites, which would more than double `src/`'s total in one
commit. Each has a cheap replacement:

**Before you run the verify grep, know what it will show you**, because the number
is much larger than this section and I do not want you fixing closed tasks.
`COMMAND`, run at dispatch: `test/` holds **29** further casts, in six files, and
every one is the same single idiom — `(err as ContentError)` on a value caught from
a rejected promise (`test/content/task.test.ts`, `bank.test.ts`,
`concept.test.ts`, `objectives.test.ts`, `test/validate/expectations.test.ts`).
Those are **parked, not yours**, and they are a different problem from the seven
below: narrowing a caught `unknown` needs an `instanceof ContentError` guard, which
is a sweep across six closed test files. `scripts/` holds **zero** — an earlier
ledger note of mine claiming casts at `scripts/extract-corpus.ts:47-53` is stale
and I have measured it wrong; ignore it.

So the bar for this task is: `src/` stays at exactly those five lines, `test/`
gains **no new cast of any kind** — and in particular none of the two
`as unknown as` / `as never` fixture casts in mandate 3's table, which are a worse
idiom than the parked 29 because they defeat the type they claim to model rather
than merely skipping a guard.

| site | replacement |
|---|---|
| `app.ts` `const mode = body.mode as SessionMode` | a predicate: `function isSessionMode(v: unknown): v is SessionMode { return typeof v === 'string' && MODES.has(v) }`, then `if (!isSessionMode(body.mode)) return 400`. This also removes the separate `MODES.has` check. |
| `app.ts` `(await c.req.json().catch(() => ({}))) as { taskId?: string; mode?: string }` | keep it `unknown`; narrow with an `isRecord` guard (`objectives.ts:20` already has that exact helper to copy) and `typeof` on each field |
| `app.ts` `([1, 2, 3, 4, 5] as Rung[])` | `RUNGS` from `ladder.ts` — see mandate 4 |
| `terminal.ts` `const m = msg as { type?: unknown; ... }` | narrow: after the `typeof msg !== 'object'` check, use `'type' in msg` plus `typeof` reads, or two small predicates `isInputFrame` / `isResizeFrame`. The test "ignores malformed frames" is the regression net either way. |
| `index.ts` `serve({...}) as unknown as Server` | `@hono/node-server` exports its own `ServerType`. Type the variable as that and widen `attachTerminal`'s parameter, or narrow with `instanceof`. **Measure what `serve` actually returns after Step 1's install** — a double cast through `unknown` is the strongest possible admission that nobody checked. |
| `content.test.ts` `as unknown as TaskSpec` | build the full object and use `satisfies TaskSpec`, exactly as `app.test.ts` does for `TASK` in this same task |
| `content.test.ts` `as never` | build the full object and use `satisfies ConceptSpec`, as `app.test.ts` does for `CONCEPT` |

The last two matter more than they look: the same task contains both idioms
twelve hundred lines apart, and the good one is already there to copy. A test
fixture cast with `as unknown as` stops tracking the interface it claims to
model, which is how a test keeps passing after the type it tests has changed.

## 4. `maxRungFor`'s `5` is a magic number the ladder already owns

```ts
  return mode === 'guided' ? 5 : MAX_RUNG[mode]
```

Task 12's review parked this (plan line 9202): the literal `5` duplicates
`MAX_RUNG.practice`, and nothing makes them move together. **Task 23 is the
owner** — it is the task that introduces `maxRungFor`. There is no such constant
in `ladder.ts` today; I read the whole file. Add both, in `ladder.ts`, next to
`MAX_RUNG`:

```ts
/** The top of the ladder. `guided` mode sits here by construction. */
export const TOP_RUNG: Rung = 5

/** Every rung, in order. Typed here so no caller needs a cast to build it. */
export const RUNGS: readonly Rung[] = [1, 2, 3, 4, 5]
```

Then `maxRungFor` returns `TOP_RUNG` for guided, `SessionStore.advanceRung`'s
guided branch sets `TOP_RUNG`, and `/hint`'s guided branch maps over `RUNGS`.
That is one definition instead of three literals, and it removes the
`as Rung[]` cast from mandate 3's list for free.

While there: `all[all.length - 1]` is `RungContent | undefined` under
`noUncheckedIndexedAccess`. Use `rungContent(TOP_RUNG, ctx)` for the `content`
field instead of indexing.

## 5. `commandSketch` puts `]]`, `d'` and `fstab` in front of the student as commands to look up

This is rung 4 — student-facing content, presented as "The commands you need …
Each one has a man page. Read the one you are least sure about." I ran the
brief's implementation verbatim over ordinary bash. Measured, before/after my
fix:

```
brief SOLUTION     before=["lvextend","xfs_growfs","blkid","sed","printf","tee","systemctl"]
                    after=["lvextend","xfs_growfs","blkid","sed","printf","tee","systemctl"]
brief HEREDOC      before=["tee","systemctl"]
                    after=["tee","systemctl"]
real solution 02   before=["lvextend","blkid","sed","home[[:space:]]","d'","printf","tee","systemctl"]
                    after=["lvextend","blkid","sed","printf","tee","systemctl"]
bracket test       before=["]]","echo"]
                    after=["echo"]
single bracket     before=["fstab","cat"]
                    after=["cat"]
for loop           before=["u","useradd"]
                    after=["u","useradd"]
case               before=["case","a","lvs","esac"]
                    after=["a","lvs"]
env prefix         before=["lvs"]
                    after=["lvs"]
```

- `real solution 02` is Task 21's **actual** `solutions/02-lvextend-r-by-uuid.sh`,
  whose fstab line is `sudo sed -i '\|[[:space:]]/home[[:space:]]|d' /etc/fstab`.
  The `[|;]` splitter tears the sed expression apart on the `|` delimiters.
- `single bracket` is the worst shape: `[` is in `NOISE` and `-f` is skipped for
  its leading dash, so the walk continues into the **argument** and emits the
  basename of `/etc/fstab`.
- **Scope, stated honestly: none of this is live in Phase 1 today.** Rung 4 uses
  `scripts.fixtures.find(f => f.kind === 'solution')`, and `loadTaskScripts`
  sorts names, so the *first* solution wins — for Task 21 that is
  `01-lvextend-then-growfs.sh`, two straight `sudo` lines, which comes out clean.
  I also grepped Task 22's four tasks: their `for` loop is in a `setup.sh` and
  their only `[[` hits are `[[:space:]]` inside `grep -E` patterns, so no first
  solution in Phase 1 trips this. It is a latent defect in a heuristic that
  twenty-eight tasks of content will be fed through, and the fix is four words
  in a Set plus one regex.

**Required changes**, all three together — I measured that they preserve both of
the brief's existing `commandSketch` expectations byte for byte:

1. Add to `NOISE`: `']'`, `']]'`, `'in'`, `'case'`, `'esac'`, `'until'`,
   `'select'`, `'function'`, `'time'`, `'test'`, `'!'`.
2. Add a shape guard and only emit words that could be a command name:
   ```ts
   /** A command name, after stripping any leading path. Anything else is a
    * fragment of shell syntax or an argument, and putting it in front of the
    * student as something to read the man page for is worse than omitting it. */
   const COMMAND_SHAPE = /^[A-Za-z_][A-Za-z0-9_.+-]*$/
   ```
3. **Stop at the first word that is not noise or an assignment, instead of
   walking past it.** In the brief, a leading-dash or `$`-bearing word
   `continue`s, so the loop keeps going into the arguments — that is exactly how
   `/etc/fstab` becomes a "command". Only `ASSIGNMENT` and `NOISE` may
   `continue`; everything else emits if it matches `COMMAND_SHAPE` and then
   `break`s either way.

Document the residual limits in the doc comment, because they are real and I did
not fix them: `for u in alice bob` still emits the loop variable `u`, and a
`case` pattern label still emits (`a`). Both need a shell parser to get right,
which is not what rung 4 is worth. Say in the comment that the sketch is a hint
rather than a spec, and that a task's **first** solution should be written as
straight-line commands for this reason — that is an authoring convention Task 25
should carry into the content guide.

**Add three tests**: the real solution-02 sed line (assert no entry contains `[`
or `'`), an `if [[ -n $x ]]; then` line (assert `]]` absent), and an
`if [ -f /etc/fstab ]; then` line (assert `fstab` absent). Assert absence rather
than a full exact list — an exact list over-specifies a heuristic and the next
person to improve it will delete the test instead of the bug.

## 6. `countCheckpoints` is fed the assertion library too — pin it

`loadTaskScripts` returns `grade: `${assertLib}\n${gradeBody}`` (harness.ts:65),
so `countCheckpoints(scripts.grade)` scans `content/lib/assert.sh` as well as the
grader. That is fine today — measured above, zero matching lines — but the number
it produces is the **masked checkpoint total the student sees in exam mode**, and
the failure is silent: one `#`-free usage example added to `assert.sh` inflates
every task's total at once, and nothing fails.

Add a comment at the call site in `app.ts` saying so, and add a regression test
in `test/server/session.test.ts` that reads the real library:

```ts
  it('finds no checkpoints in the assertion library that gets prepended to every grader', async () => {
    // loadTaskScripts hands `assertLib + grade.sh` to countCheckpoints, so an
    // example `ck` call in a comment-free line of assert.sh would inflate the
    // masked total for every task at once, silently.
    const lib = await readFile(fileURLToPath(new URL('../../content/lib/assert.sh', import.meta.url)), 'utf8')
    expect(countCheckpoints(lib)).toBe(0)
  })
```

Use `fileURLToPath`, not `new URL(...).pathname` — see mandate 8.

## 7. A truncated grader run can report `allPassed: true` — and only verdict A is unguarded

**Label: `READ` for the code, `TRACED` for the failure.** I quote both functions by
line, but I have not executed a truncated grader stream — I have not confirmed that
a mid-stream stop yields a short `checkpoints` array rather than a parse error or an
empty verdict. That distinction decides whether this mandate is a real bug or a
guard against a state the parser never produces. **Establish it before you write
the fix**, and if the parser actually rejects a truncated stream, say so and treat
this mandate as defence-in-depth rather than a bug fix — the guard is still correct
either way, but the commit message must not call it a bug if it is not one. The
break-and-revert step below is what converts this from my trace to your
measurement; do not skip it.

`reportFor` computes `total` from the verdict that arrived:

```ts
    passed: v.checkpoints.filter((c) => c.status === 'pass').length,
    total: v.checkpoints.length,
    allPassed: allPassed(v),
```

`allPassed` is `checkpoints.length > 0 && every(status === 'pass')`. So a grader
that emitted three of its seven checkpoints and then stopped — a 124 timeout
partway through the stream, a guest that wedged on an `lvs`, an early `exit` —
produces `passed: 3, total: 3, allPassed: true`. **The student is told they
passed a task they did not finish being graded on.**

Verdict **B** already has a backstop for exactly this: `completeVerdictB`
(`grader.ts`) fills any id A saw but B never emitted as `fail`, with
`NOT_REPORTED_DETAIL` = "this checkpoint was not reported after the reboot; the
grader likely stopped before reaching it". **Verdict A has no equivalent** —
there is nothing above it to compare against inside `grade()`. But the session
already knows the answer: `checkpointTotal`, counted statically from the grade
script when the session was created.

The validation harness catches this shape for fixtures (`checkEmittedIds` against
`# baseline-fail:`), but that is `rhcsa validate`, not the student-facing path.
`LabRuntime.gradeTask` calls `grade()` directly, so nothing on the route the user
actually takes compares declared against emitted.

**Required:** give `reportFor` the expected total and refuse to call a partial
verdict a pass:

```ts
export function reportFor(
  mode: SessionMode,
  result: GradeResult,
  revealed: boolean,
  expectedTotal: number,
): GradeReport {
  const v = finalVerdict(result)
  // A grader that stopped early emits fewer checkpoints than it declares, and
  // `allPassed` only looks at the ones that arrived - so a truncated run of an
  // untouched machine would report a pass. countCheckpoints gave us the real
  // number before anything ran; trust that one.
  const incomplete = v.checkpoints.length < expectedTotal
  ...
  allPassed: allPassed(v) && !incomplete,
  incomplete,
  expectedTotal,
```

Add `incomplete: boolean` and `expectedTotal: number` to `GradeReport`, pass
`s.checkpointTotal` from both call sites in `app.ts`, and surface `incomplete` in
the JSON so Task 24 can render it. **Add two tests**: a verdict with fewer
checkpoints than `expectedTotal` and all of them passing must report
`allPassed: false` and `incomplete: true`; a full verdict must report
`incomplete: false`. Then delete the `&& !incomplete` and watch the first test
fail — paste what the failure looked like.

Do **not** change `grader.ts` or `verdict.ts` to do this. `allPassed(v)` is
correct about the verdict it is given; the missing information lives in the
session, which is where the comparison belongs.

## 8. `fileURLToPath` in the new test files

Four test files are new here. `.pathname` is a URL path, not a filesystem path —
it percent-encodes, so a space in a parent directory yields a path that does not
exist. **Do not make it eleven, and do not touch the seven** (they belong to
closed tasks).

`COMMAND`, and I am naming the seven because my own first grep got this wrong and
yours will too: `grep -rn '\.pathname' test/` returns **nine** files, but two of
them — `test/lib/assert.test.ts` and `test/cli/validate.test.ts` — already use
`fileURLToPath` and merely mention `.pathname` in a comment explaining why. The
seven real users are `test/content/bank.test.ts` (7 occurrences),
`test/cli/coverage.test.ts` (3), `test/content/objectives-golden.test.ts` (2),
and one each in `test/content/concept.test.ts`, `objectives-real.test.ts`,
`task.test.ts`, `objectives.test.ts`. Grep for the call, not the word.

```ts
import { fileURLToPath } from 'node:url'
```

## 9. Four one-line items

- **`RHCSA_PORT` is unvalidated.** `Number(process.env.RHCSA_PORT ?? 5175)`
  yields `NaN` for a typo and `serve` fails with something unhelpful.
  `loadVmConfig` already validates `RHCSA_SSH_PORT` with
  `Number.isInteger(p) && p >= 1 && p <= 65535` and a message naming the
  variable — copy that shape.
- **The `/hint` comment is wrong.** It says "canAdvance said no", but the code
  catches `advance()`'s throw and `canAdvance` is never called. Say what
  actually happened: `advanceRung` threw because the mode's cap was reached.
  Keep the 409, and keep the reasoning for choosing 409 over 400.
- **Rung 4 with no commands renders a dangling heading.** If `commandSketch`
  returns `[]`, the body is "In roughly this order, arguments omitted:" followed
  by nothing, then "Each one has a man page." Emit an explicit line for the
  empty case instead.
- **`maxRungFor` is missing from the task's `Produces` block** even though
  `session.test.ts` imports it. Documentation only; add it.

---

## Step 20 is deferred — and Task 24 does not wait for it

Step 20 drives the API and the WebSocket against the real VM. **The VM does not
exist** — the RHEL 9 ISO is a user-owned blocker. Ruling: mark Step 20 deferred,
the same way Task 19's Step 5, Task 21's Step 12 and Task 22's Steps 9-10 are,
and let Task 24 proceed against the tests. Blocking on a user-owned download
would stop the run with two tasks of authorable work left and buy nothing.

Two of Step 20's stated expectations are **predictions about content that does
not exist yet**, not assertions: `{"ok":true,"transport":"ssh","tasks":5}` and
`"checkpointTotal":5`. Task 21 authors one task and Task 22 authors four, so
"5 tasks" is only true after Task 22 lands, and the checkpoint total depends on
Task 21's final grader. Do not encode either number in a test. In the report,
list what each numbered step will prove when it runs, and state plainly that no
part of Step 20 has been executed.

`npx wscat` fetches a package from the network at acceptance time. Note it; it is
not a problem, but it is not offline either.

## Out of scope

- **No VM operations.** Do not start, stop, snapshot, revert, or delete a
  snapshot on any VM. The user's Ubuntu and Windows 11 guests are unrelated to
  this project.
- **No `sudo` on this WSL host** — there is no TTY and it cannot authenticate.
- **Do not run `scripts/provision.sh`** — it powers on a VM and copies 10 GB.
- **Do not create, read, or modify `.env.local`.** It may hold the user's real VM
  password. Do not run `ssh-keygen` or write anything into
  `/home/daxtangco/.ssh/`: `provision.sh` resolves `RHCSA_SSH_KEY` against the
  real `$HOME`, and an earlier agent wrote a real keypair there by accident.
- **Do not start a long-running server** as part of ordinary development. Hono's
  `app.request()` is a full round-trip through the router, so every API test runs
  with no listening socket. If you need to check `index.ts` boots, do it once,
  in the foreground, and stop it.
- **Never** read or copy `.env`, `.env.sandbox`, or `.env.example` from
  `/home/daxtangco/sechelp-tools` — an unrelated project's real secrets.
- Do not modify `src/engine/grading/*`, `src/engine/content/*`, or
  `src/engine/validate/*`. The only pre-existing engine files this task touches
  are `ladder.ts` (mandate 4) and `ssh.ts` (mandate 1).
- Do not touch the five parked `as` cast sites listed in mandate 3, or the seven
  parked `.pathname` test files.
- Do not add a helper to `content/lib/assert.sh`; that file is closed.
- Do not dispatch subagents.

## Verify before committing

1. `npx vitest run test/vm/ssh.test.ts` before and after mandate 1's refactor,
   both pasted. `test/vm/ssh.test.ts` must be unmodified.
2. Mandate 2's two upgrade tests, and a note of what
   `@hono/node-server`'s `serve` returns and whether it defaults to loopback.
3. Mandate 5's before/after table reproduced from **your** implementation, over
   at least the eight cases above.
4. Mandate 7's break-and-revert, with the observed failure described.
5. `grep -rnE "\bas ([A-Z]|unknown|const\b)" src/ test/ scripts/ | grep -v "as const"` —
   paste it. Expect **34 lines**: the five in `src/` quoted in mandate 3, and 29
   `as ContentError` lines in `test/`. Both sets are parked and neither is yours.
   The pass condition is that the count does not go **up**: still 5 in `src/`,
   still 29 in `test/`, still 0 in `scripts/`, and no `as unknown as` or `as never`
   anywhere. If your count differs from mine, yours is the measurement — say so and
   report the delta rather than reconciling to my number.
6. `npx vitest run` and `npm run typecheck` both clean. **Report the totals you
   observe**; read the baseline from `git log` and your own run, not from any
   number in this file. Tasks 21 and 22 are landing tests around you.
7. `git status --porcelain` empty after committing, and stage **by name** — never
   `git add -A`, never `git commit -a`. Files outside this task's list are not
   yours: do not revert or commit them, just note them.

Report to `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-report.md`
as a real file, including every pasted run above, the observed totals, the
Step 20 deferral with what each numbered check will prove, and an explicit
statement that nothing in this task has been exercised against a real VM or a
real browser.

---

## 10. Addendum, found during the Task 24 pre-flight: `transport` in the session response means the wrong thing, and no test can tell

The session-create response sets

```ts
        transport: deps.runtime.transportKind,
```

(brief line 1243) — the transport **the server is using**. But Task 24's Lab
screen consumes that field as the transport **the task requires**, and warns the
student when the two disagree:

```tsx
  const mismatch =
    props.serverTransport !== undefined && props.serverTransport !== session.transport
```

`serverTransport` comes from `/api/health`, which returns
`deps.runtime.transportKind` (brief line 1166) — **the same value**. So
`mismatch` compares a value to itself and is false for every real session. The
warning that tells a student to go work at the VMware console because this task
cannot be driven over ssh can never appear.

Task 24's test for it passes anyway, because it hand-builds
`session({ transport: 'vmrun' })` with `serverTransport="ssh"` — a state the
server cannot produce. And no Task 23 test can catch it either: the `TASK`
fixture is `transport: 'ssh'` (brief line 782) and the fake runtime is
`transportKind: 'ssh'` (line 826), so `expect(body.transport).toBe('ssh')`
passes under *either* meaning of the field. A green suite on both sides of a
dead feature. This is the project's signature defect class — a check that
reports success without doing what was asked — reaching the screen.

**Required:** the session-create response carries both, under names that say
which is which:

```ts
        /** What the task needs. `vmrun`-only tasks cannot be driven over ssh. */
        taskTransport: task.transport,
        /** What this server is actually using. */
        transport: deps.runtime.transportKind,
```

Keep `transport` meaning the server's transport, since `/api/health` already
uses that name for that thing and `StartedSession` consumers read it that way.
Add `taskTransport` alongside.

**Add one test** that distinguishes them — this is the point of the change, so
it cannot be skipped: a task fixture with `transport: 'vmrun'` against the
`ssh` fake runtime must return `taskTransport: 'vmrun'` and `transport: 'ssh'`.
Build a second fixture with `satisfies TaskSpec` rather than casting.

`Ruling: fix this in Task 23 rather than Task 24, and add taskTransport rather
than changing what transport means. Task 23 owns the response, and a Task
24-side workaround would have to re-fetch /api/tasks/:id just to learn a field
the session response already had in hand. Naming the new field instead of
redefining the old one keeps /api/health and the session response agreeing on
what "transport" means, so the next reader does not have to check which
endpoint they are looking at. Cost if wrong: one extra field on one response
and one test.`
