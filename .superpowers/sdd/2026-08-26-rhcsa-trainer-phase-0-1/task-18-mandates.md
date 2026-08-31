# Task 18 — mandated changes to the brief

Seven **required** changes. They override `task-18-brief.md` wherever they
conflict; everything else in the brief stands, including its file list, its
interfaces, its test bodies, and its commit message.

**Read the measurement warning first.** Every claim below that rests on a number
or an observed behaviour came from a command I ran on this machine and pasted
verbatim. Five times in this project I have handed an implementer a confident
measurement, and one turned out wrong. So: **confirm anything you depend on with
your own command. If your measurement disagrees with mine, yours wins — say so in
the report and act on yours.**

## Measured facts these mandates rest on

Run on this host, `node v22.23.2`, `OpenSSH_10.2p1`:

```
--- /bin/cat stdin roundtrip via execFile ---
cat err: none  stdout: "hello-from-stdin\n"

--- ssh_config(5) on StrictHostKeyChecking=accept-new ---
"ssh will automatically add new host keys to the user's known_hosts file, but
 will not permit connections to hosts with changed host keys."
```

`ssh` is installed at `/usr/bin/ssh`. `npm test` is `vitest run`. `VmConfig`
(Task 17, `src/engine/vm/config.ts`) already carries `ip?`, `sshUser`,
`sshPort`, and `sshKey`, so it structurally satisfies the brief's
`SshConfigSlice` — confirmed by reading the file, not assumed.

### Two things I suspected and measured as NOT defects — do not "fix" them, and do not spend a review finding on them

I expected both of these to be bugs. They are not. They are recorded here so
that neither you nor the reviewer burns effort re-deriving them:

1. **Writing to `child.stdin` after the child has already exited does not crash
   the process.** I expected an unhandled `'error'` (EPIPE) event. I ran
   `execFile('/bin/false')`, waited 150 ms for it to exit, then called
   `child.stdin.end()` with a 4 MB payload under a `process.on('uncaughtException')`
   watcher: no synchronous throw and no uncaught exception. So
   `child.stdin?.end(stdin)` as the brief writes it needs no `'error'` handler.
2. **A late rejection from the losing side of `Promise.race` is not an unhandled
   rejection.** I expected `availableWithin`'s `try/catch` to cover only the fast
   half, leaving a post-deadline rejection to crash Node 22. It does not:
   `Promise.race` subscribes to every input promise, so the loser's rejection is
   absorbed by race's own handler and silently discarded. Measured with a promise
   rejecting at 100 ms against a timeout resolving at 10 ms under
   `process.on('unhandledRejection')` — nothing fired. `availableWithin` is
   correct as the brief writes it.

## 1. `realSshRunner` needs a timeout, and must report a timeout as a timeout

This is Task 17 mandate 1 again, in a new file. The brief's `realSshRunner`
passes only `{ maxBuffer: 32 * 1024 * 1024 }` to `execFile` — **no `timeout`** —
so a wedged `ssh` hangs forever.

**`ConnectTimeout=10` does not cover this**, and it is important not to mistake
it for coverage: it bounds the *connect* phase only. Once the connection is
established, a grader script that blocks — waiting on a device, a lock, an NFS
mount, `systemctl` on a hung unit — hangs with no ceiling at all. Task 16
watched exactly this happen against a real guest through the other transport.

And the brief's code has the same second defect:

```ts
const code = err && typeof (err as { code?: unknown }).code === 'number'
  ? (err as { code: number }).code
  : err ? 1 : 0
```

On a killed child, `execFile`'s `code` is `null` with `killed: true` and a
`signal` — measured in Task 17 — so this reports a two-minute hang as a plain
`exit 1`, indistinguishable from a script that simply failed.

- `export function makeSshRunner(opts: { timeoutMs?: number } = {}): SshRunner`,
  defaulting to `120_000`.
- `export const realSshRunner: SshRunner = makeSshRunner()` — keep the exported
  name and type, because `SshTransport`'s constructor defaults to it.
- Pass `timeout` through to `execFile`.
- When the child was killed by the timeout (`killed === true`, or `code` is not a
  number and a `signal` is present), return code **`124`** with a stderr saying
  what timed out and after how long. `124` is what `timeout(1)` returns, what
  `scripts/r1-probe.sh` teaches the reader to read as "timed out silently", and
  what Task 17's `makeRunner` already returns. One meaning for one number across
  the project; do not invent a second.

`120_000` is a ceiling for a wedged connection, not a latency budget. Do not
lower it for correctness reasons — mandate 7 covers the separate, shorter ceiling
that selection needs.

There is no mandate-2-style credential redaction to do here: `ssh` authenticates
with a key file, so its argv contains a *path* (`-i /home/u/.ssh/rhcsa_lab`) and
never a secret. Say so in a one-line comment, so the next reader can see the
asymmetry with `vmrun.ts` is deliberate rather than an oversight.

## 2. Nothing in the brief proves the real runner actually delivers stdin

The brief's headline design decision is that the script travels on **stdin**
rather than argv, and its own design note explains why: quoting a multi-line
bash script through argv is the classic source of grading bugs. Every test that
checks it uses `recorder()` — a mock that records what it was handed. So the
suite proves `SshTransport` *passes* the script to its runner's third parameter
and proves nothing whatever about whether `realSshRunner` puts it on the child's
stdin. Delete the `child.stdin?.end(stdin)` line and all nine ssh tests still
pass. **That is the exact defect class this project keeps finding: a check that
passes for the wrong reason.**

`/bin/cat` closes it with no hypervisor, no network, and no `ssh`:

```ts
it('the real runner delivers the script on the child stdin, not argv', async () => {
  // The mocked tests above prove SshTransport hands the script to its runner.
  // Only this one proves the runner actually writes it to the child.
  const r = await makeSshRunner()('/bin/cat', [], 'hello-from-stdin\n')
  expect(r.code).toBe(0)
  expect(r.stdout).toBe('hello-from-stdin\n')
})
```

Measured above: this exact shape returns `stdout: "hello-from-stdin\n"` with no
error. Add the timeout test too, mirroring Task 17's:

```ts
it('reports a hung command as 124 rather than as a plain failure', async () => {
  const r = await makeSshRunner({ timeoutMs: 200 })('/bin/sh', ['-c', 'sleep 5'])
  expect(r.code).toBe(124)
  expect(r.stderr).toMatch(/timed out/i)
})
```

These two are the only tests in this task that touch the real `execFile`; both
finish well under a second and depend on nothing but `/bin/cat` and `/bin/sh`. If
either binary is missing, say so in the report and adapt rather than deleting the
test.

**Break the stdin test to confirm it is probative**: comment out
`child.stdin?.end(stdin)` and watch it fail, then restore. Report what the
failure looked like. A test whose failure you have not seen is a test you have
not written.

## 3. A pinned `fake` transport is silently ignored

```ts
const pinned = opts.require ?? cfg.forceTransport
if (pinned === 'ssh' || pinned === 'vmrun') { … }

if (await availableWithin(ssh, ms)) return ssh
```

`TransportKind` is `'ssh' | 'vmrun' | 'fake'`, and Task 17's `loadVmConfig`
validates `RHCSA_TRANSPORT` against `KINDS = { ssh: true, vmrun: true, fake: true }`
— so `fake` is an **accepted** value and `cfg.forceTransport === 'fake'` is
reachable through documented configuration. When it happens, the `if` falls
through, selection proceeds normally, and the caller gets a live `SshTransport`
against their real VM. The user pinned one thing and silently received another,
with no error and nothing in any output to say so.

This is the recurring defect inverted once more: not a check that passes for the
wrong reason, but a pin that is *accepted and then discarded*.

Handle it explicitly. `select.ts` must not import `fake.ts` — test scaffolding
does not belong in the production selector, and `ChooseOptions` has no `fake`
slot to put one in — so the honest outcome is a legible refusal:

```ts
if (pinned === 'fake') {
  throw new Error(
    "the 'fake' transport is not selectable: it exists for tests and is " +
      'constructed directly with a handler. Unset RHCSA_TRANSPORT, or set it ' +
      'to ssh or vmrun.',
  )
}
```

Place it before the `'ssh' | 'vmrun'` branch, and add a test asserting both that
it throws and that the message names `RHCSA_TRANSPORT` — a reader who set an
environment variable needs to be told which one to unset.

**Do not change `config.ts` to reject `fake`.** Task 17 is closed and its
`KINDS` record is exhaustive over the *type* on purpose. That the set of valid
`TransportKind`s and the set of valid `RHCSA_TRANSPORT` values are not the same
set is the real root cause; it is recorded in the ledger and forwarded to the
final whole-branch review. Your job is to stop the silent fallthrough here.

## 4. The known_hosts justification is false — fix the comment, keep the code

```ts
/** Separate from the user's known_hosts: snapshot reverts change host keys. */
const KNOWN_HOSTS = join(homedir(), '.ssh', 'rhcsa_known_hosts')
```

and the design note: *"a dedicated `UserKnownHostsFile` so reverting snapshots
does not trip host-key warnings on the user's real `known_hosts`."*

Both are wrong about the mechanism, in a way that would mislead whoever debugs
the first host-key failure:

- **A snapshot revert restores the guest's host keys along with everything else
  in the filesystem.** It cannot change them. What changes host keys is
  *rebuilding* the VM — a reinstall from the ISO — which this project expects,
  since `docs/vm-build-checklist.md` is a build guide and a rebuild is the
  recovery path of last resort.
- **`accept-new` does not rescue a changed key anyway.** From `ssh_config(5)` on
  this host, quoted above: it adds *new* host keys automatically but "will not
  permit connections to hosts with changed host keys." So on a rebuilt VM, ssh
  fails hard regardless of this setting.

The dedicated file is still the right call — its real value is that when a
rebuild does invalidate the key, the failure and its fix are confined to a
throwaway file the user can delete outright, instead of an editing session in the
`known_hosts` they use for real work. Rewrite the comment and the design note to
say that. **Do not change the code**: the constant, the option, and
`accept-new` all stay exactly as the brief writes them.

## 5. The probe echoes a marker it never checks

```ts
const r = await this.#run('ssh', this.#args(), 'echo rhcsa-probe\n')
return r.code === 0
```

`rhcsa-probe` is written and then discarded, so the probe is really just "did ssh
exit 0". That is weaker than it looks: ssh can exit 0 having established a
session where the remote `bash -s` never ran the script at all — a `ForceCommand`
in the guest's sshd config, or a login shell that consumes stdin, both produce
exit 0 with the script silently unexecuted. Checking the marker is what makes the
probe test the thing it is named for: that this transport can *run a script*, not
merely that it can connect.

Make the marker load-bearing:

```ts
const r = await this.#run('ssh', this.#args(), 'echo rhcsa-probe\n')
// Not just code 0: ssh can exit 0 with the remote bash never running the
// script (a guest-side ForceCommand, a shell that eats stdin). The marker is
// what proves a script actually executed.
return r.code === 0 && r.stdout.includes('rhcsa-probe')
```

This **requires changing one of the brief's test fixtures**, which is why it is a
mandate and not a suggestion. The brief's test is:

```ts
it('isAvailable is true when a probe command succeeds', async () => {
  const r = recorder({ stdout: 'ok\n', stderr: '', code: 0 })
```

`'ok\n'` does not contain the marker, so that test would now fail. Change the
fixture to `{ stdout: 'rhcsa-probe\n', stderr: '', code: 0 }` and add one more
case asserting the discriminating behaviour:

```ts
it('isAvailable is false when ssh exits 0 but the script never ran', async () => {
  // A guest-side ForceCommand, or a shell that swallows stdin: connection
  // fine, script never executed. This must not count as available.
  const r = recorder({ stdout: 'Last login: …\n', stderr: '', code: 0 })
  expect(await new SshTransport(CFG, r.runner).isAvailable()).toBe(false)
})
```

Keep every other assertion in the brief's ssh tests unchanged.

## 6. The acceptance step cannot work as written

Step 7 runs `node --input-type=module -e "…loadVmConfig(process.env)…"` twice.
Nothing in this project loads `.env.local` into `process.env`, and `RHCSA_VMX`
lives there per `docs/vm-build-checklist.md` §6 — so a reader who did exactly
what §6 told them gets `RHCSA_VMX is not set. Put it in .env.local…`, an error
instructing them to do the thing they just did. This is the same defect Task 17
mandate 9 fixed in its own Step 7; the plan's answer exists at five other sites.

Add `--env-file-if-exists=.env.local` to **both** invocations in Step 7:

```bash
node --env-file-if-exists=.env.local --input-type=module -e "…"
```

**Step 7 stays deferred.** The RHEL VM does not exist; the ISO is a user-owned
blocker. In your report, mark it deferred and state plainly what its second half
will prove when the VM exists — that stopping `sshd` from the console makes
`chooseTransport` return `vmrun`. That is the claim the entire dual control plane
rests on, and until it runs against a real guest it is untested.

**Do not perform Step 7, and do not run any VM operation.** Do not start, stop,
snapshot, or revert any VM on this host — in particular not the user's Ubuntu or
Windows 11 guests, which are unrelated to this project. Do not stop `sshd`
anywhere.

## 7. Say what the probe ceiling costs when it fires

`PROBE_TIMEOUT_MS = 3000` is deliberately shorter than SSH's own
`ConnectTimeout=10`, and the brief explains that it bounds how long *selection*
may take. What it does not say is the consequence: on a link that needs more
than 3 s to establish — a loaded NAT, a guest still finishing boot — ssh is
declared unavailable and selection silently falls back to `vmrun`, which costs
three `vmrun` round trips per `exec` for the rest of the session. Everything
still works, just several times slower, with nothing anywhere saying why.

Extend the comment on `PROBE_TIMEOUT_MS` to state that consequence, and note
that the abandoned ssh probe is not cancelled — it runs on under mandate 1's
120 s ceiling and its result is discarded. Comment only; **do not change the
timeout and do not add cancellation.** Getting this wrong in code costs a real
grading path; getting it wrong in a comment costs one reader's confusion, and
`chooseTransport` accepts `probeTimeoutMs` already for anyone who needs to widen
it.

## Out of scope

- Do not touch `content/`, `docs/`, `README.md`, or `package.json`.
- Do not modify `src/engine/vm/config.ts`, `vmrun.ts`, `transport.ts`, or
  `fake.ts` — Tasks 2 and 17 own them and both are closed. If you believe one of
  them is wrong, say so in the report and leave it alone.
- Do not create or modify `.env.local`.
- Do not implement `scripts/provision.sh` or the sudoers drop-in — Task 19.
- No `sudo` on this WSL host: there is no TTY, it cannot authenticate, and
  nothing here needs it.
- Never read or copy `.env`, `.env.sandbox`, or `.env.example` from
  `/home/daxtangco/sechelp-tools` — an unrelated project's secrets.
- Do not dispatch subagents.

## Verify before committing

1. `npx vitest run` and `npm run typecheck` both clean.
2. **Report the totals you observe; do not trust mine.** The branch was at
   **183 passing / 18 files** after Task 17. The brief predicts 9 ssh + 7 select
   tests; these mandates add three (mandate 2 adds two, mandate 3 adds one,
   mandate 5 adds one and edits a fixture), so the number will differ from both
   the brief's prediction and any arithmetic I do here. State the measured
   totals.
3. Mandate 2's break-and-revert must actually have been run. Say so, and say what
   the failure looked like.
4. Confirm `select.ts` does not import `fake.ts`:
   `grep -n "fake" src/engine/vm/select.ts` should return nothing.
5. Confirm no new `as` casts and no non-null `!` assertions entered `src/`. The
   brief's `realSshRunner` contains two `as` casts in its `code` derivation
   (`(err as { code?: unknown }).code`); mandate 1 rewrites that block, so
   narrow `err` with a local type predicate rather than carrying the casts
   forward. The one parked cast in `config.ts` is not yours to touch.

   **Write that predicate to be extractable, because a second site is already
   waiting for it.** Task 17's review found the same shape at
   `src/engine/vm/vmrun.ts:49` — `const err = e as { code?: unknown; stderr?: string; … }`
   in its catch block, inherited unchanged from that task's brief. It is parked,
   not yours to edit, and Task 17 is closed. But yours is the first deliberate
   version of this idiom in the tree, so the final whole-branch review will
   align `vmrun.ts:49` to whatever you land. Keep it generic — a predicate about
   the shape of a caught `execFile` error, with no `ssh`-specific naming or
   fields baked in — so that alignment is a move, not a rewrite. Do **not** try
   to share it across the two files now: that would mean editing `vmrun.ts`,
   which is out of scope above.
6. `git status --porcelain` empty after committing.

Report to `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-18-report.md`
as a real file. Include the observed test totals, the mandate-2 break-and-revert
result, and confirmation that Step 7 was deferred rather than attempted.
