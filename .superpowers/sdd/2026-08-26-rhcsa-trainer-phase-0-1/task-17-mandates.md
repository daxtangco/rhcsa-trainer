# Task 17 — mandated changes to the brief

Nine **required** changes. They override `task-17-brief.md` wherever they
conflict; everything else in the brief stands, including its file list, its
interfaces, and its commit message.

**Read the measurement warning first.** Every number and output below came from a
command I ran on this machine and pasted verbatim. Four times in this project I
have handed an implementer a confident measurement that was wrong, and the
escape clause is the only reason it cost nothing each time. So: **confirm
anything you depend on with your own command. If your measurement disagrees with
mine, yours wins — say so in the report and act on yours.**

Two of these mandates exist because Task 16 hit the failure live, not because I
imagined it. `docs/r1-findings.md` records that `vmrun getGuestIPAddress` and
`vmrun stop … soft` both **hung indefinitely** against a guest whose
`open-vm-tools` was absent — `getGuestIPAddress` had to be killed after several
minutes, and `stop soft` never returned at all and needed a `stop hard`
fallback. The brief's `realRunner` has no timeout, so every one of those calls
can hang the trainer forever with no diagnostic.

## Measured facts these mandates rest on

Run on this host, `node v22.23.2`:

```
$ node --input-type=module -e "…promisify(execFile)…"
LEAK-TEST message: "Command failed: /bin/false -gp SUPERSECRET x\n"
  code: 1  stderr: ""
TIMEOUT-TEST after 205 ms
  message: "Command failed: /bin/sh -c sleep 5\n"
  code: null  killed: true  signal: "SIGTERM"
```

Two things fall out of that, and both are defects in the brief's `realRunner`:

1. **`execFile`'s error message echoes the full argv.** `vmrun`'s only way to
   authenticate to a guest is `-gp <password>` on the command line, so on any
   failed `vmrun` call the brief's `err.message ?? ''` fallback puts the guest
   password into `ExecResult.stderr` — a field that flows to the CLI, the API,
   and the browser.
2. **On timeout, `err.code` is `null`, not a number**, so the brief's
   `typeof err.code === 'number' ? err.code : 1` reports a hung-and-killed
   command as a plain `exit 1`. A 120-second hang and a normal failure become
   indistinguishable to every caller.

`node --env-file-if-exists=.env.local` is supported on this Node and prints
`.env.local not found. Continuing without it.` to stderr while still exiting 0.

## 1. Give `realRunner` a timeout, and report a timeout as a timeout

Add a bounded, injectable timeout. Export a factory rather than only the bare
constant, so it can be tested and so a caller with a slow operation can widen
it:

- `export function makeRunner(opts: { timeoutMs?: number } = {}): Runner`,
  defaulting to `120_000`.
- `export const realRunner: Runner = makeRunner()` — keep the existing exported
  name and type, because the brief's constructors default to it.
- Pass `timeout` through to `execFile`.
- In the catch, when the child was killed by the timeout (`killed === true`, or
  `code` is not a number and a `signal` is present), return a **distinct**
  result: code `124`, and a stderr that says what timed out and after how long.
  Use `124` because that is what `timeout(1)` returns and `scripts/r1-probe.sh`
  already teaches the reader to read `124` as "timed out silently" — one meaning
  for one number across the project.
- Never surface `err.message` unredacted (mandate 2).

`120_000` is a ceiling for a wedged hypervisor, not a latency budget: a healthy
`vmrun` guest op is well under a second, and the brief's own `VmController`
already uses `120_000` as its guest-wait ceiling. Do not lower it for
correctness reasons; a slow `revertToSnapshot` on a large VM is legitimate.

## 2. Redact the guest password out of every string `realRunner` returns

`guestAuth` puts the password in argv and `execFile`'s failure message echoes
argv verbatim — measured above. Do not pass `err.message` through. Build the
fallback message yourself from the executable and a **redacted** copy of the
args: replace the value immediately following `-gp` with something like
`<redacted>`. Prefer `err.stderr` when it is non-empty (it is `vmrun`'s own
diagnostic and does not contain argv), and fall back to your redacted line.

Put a comment on `guestAuth` stating plainly that `vmrun` has no interface for
passing a guest password other than argv, so the password is visible in the
host's process list for the duration of each call. That is inherent to `vmrun`
and not something this code can fix; it is worth a reader knowing rather than
discovering. This project's whole reason for having a redaction step is that
argv is *already* the exposure — do not let it also become a persisted string.

Add a test that does not need a hypervisor:

```ts
it('never leaks the guest password into the result, even on failure', async () => {
  const r = await makeRunner()('/bin/false', ['-gp', 'SUPERSECRET', 'x'])
  expect(r.code).not.toBe(0)
  expect(`${r.stdout}${r.stderr}`).not.toContain('SUPERSECRET')
})
```

And a test that the timeout path is distinguishable, again with no hypervisor:

```ts
it('reports a hung command as 124 rather than as a plain failure', async () => {
  const r = await makeRunner({ timeoutMs: 200 })('/bin/sh', ['-c', 'sleep 5'])
  expect(r.code).toBe(124)
  expect(r.stderr).toMatch(/timed out/i)
})
```

These are the only two tests in this task that touch the real `execFile`; both
run in well under a second and depend on nothing but `/bin/false` and `/bin/sh`.
If either binary is missing on this host, say so in the report and adapt rather
than deleting the test.

## 3. `reboot()` must not swallow host-side failures

```ts
await t.exec('sudo systemctl reboot || sudo reboot').catch(() => undefined)
```

The comment above it is right that a non-zero *result* is expected — the reboot
kills the connection mid-command. But `.catch(() => undefined)` discards
something else entirely: `exec` only ever **rejects** when staging the script on
the *host* fails (`mkdtemp`, `writeFile`) or when the injected `Runner` throws —
i.e. when `vmrun` is missing. Swallowing that turns "vmrun.exe is not where we
think it is" into a silent 120-second wait ending in
`guest did not come back within 120000ms`, which sends the reader to look at the
guest for a problem that is on the host.

Drop the `.catch`. Keep the comment, and extend it to say why the *result* is
ignored but a *rejection* is not. Add the test:

```ts
it('surfaces a host-side failure instead of waiting out the guest timeout', async () => {
  const runner = async () => {
    throw new Error('ENOENT: vmrun.exe')
  }
  const c = new VmController(CFG, runner, { pollMs: 1, timeoutMs: 30 })
  await expect(c.reboot()).rejects.toThrow(/ENOENT/)
})
```

## 4. The "reboot waits" test passes for the wrong reason — fix the test

The brief's test comments say "Unreachable for the first two probes, then up",
but `reboot()` itself consumes those probes: its own `exec` fires one
`copyFileFromHostToGuest` and one `runProgramInGuest` before `waitForGuest` runs
at all. So `expect(probes).toBeGreaterThan(2)` is satisfied by `waitForGuest`
succeeding on its **first** attempt, and the test never demonstrates the thing
it is named for — that `reboot` polls rather than sleeping once.

Rewrite it to count only `runProgramInGuest`, fail the first two, and assert an
exact count:

```ts
it('reboot polls until the guest answers, rather than sleeping once', async () => {
  let probes = 0
  const runner = async (_e: string, args: string[]): Promise<ExecResult> => {
    if (args[0] === 'runProgramInGuest') {
      probes += 1
      // Probe 1 is consumed by reboot's own reboot command. Probe 2 is
      // waitForGuest's first attempt and must fail, so that reaching probe 3
      // proves it looped instead of accepting the first answer.
      return probes <= 2
        ? { stdout: '', stderr: 'not connected', code: 255 }
        : { stdout: 'up\n', stderr: '', code: 0 }
    }
    return { stdout: '', stderr: '', code: 0 }
  }
  const c = new VmController(CFG, runner, { pollMs: 1, timeoutMs: 5000 })
  await c.reboot()
  expect(probes).toBe(3)
})
```

**Verify this by breaking it**: change `probes <= 2` to `probes <= 1` and
confirm the assertion fails. A test whose failure you have not seen is a test
you have not written. Report that you did it.

## 5. `guestScriptPath()` is not unique the way its comment claims

```ts
counter += 1
const tag = `${counter.toString(36)}${(counter * 7919).toString(36)}`
```

The comment says "Unique per exec so concurrent grading cannot clobber a staged
script." Within one process it is; across two processes both counters start at
`1` and produce the identical path. The trainer runs a server and a CLI against
the same guest, so that is a reachable collision, and the failure mode — one
grading run overwriting another's staged script — is silent and would look like
a flaky grader.

Use `randomBytes(6).toString('hex')` from `node:crypto` instead of the counter,
and drop the counter and the multiply. Keep the `/tmp/rhcsa-` prefix and the
`.sh` suffix so the brief's existing assertion
`/^\/tmp\/rhcsa-[a-z0-9]+\.sh$/` still holds — confirm it does rather than
assuming. Rewrite the comment to say what is now true.

## 6. The guest password belongs in the config, not in a `process.env` read inside `vmrun.ts`

```ts
return ['-gu', cfg.sshUser, '-gp', process.env.RHCSA_GUEST_PASSWORD ?? '']
```

Two claims in this task are false while that line exists: that `config.ts` is
where environment is read, and that `Runner` is "the single injection seam" —
`vmrun.ts` reaches around both to a global. It also makes the credential path
untestable.

- Add `guestPassword?: string` to `VmConfig` **and** to `VmrunConfigSlice`.
  Optional, so the brief's `CFG` test literal still satisfies the slice
  structurally — confirm that it does. Task 18 is unaffected either way: I
  checked, and its `chooseTransport(cfg: VmConfig, opts?: ChooseOptions)` takes
  the whole `VmConfig`, so a new field reaches it automatically and an optional
  one cannot break structural satisfaction.
- Populate it in `loadVmConfig` from `env.RHCSA_GUEST_PASSWORD`.
- Have `guestAuth` read `cfg.guestPassword ?? ''`.
- Do **not** add a config test asserting the password's value round-trips
  through a literal — assert instead that it is absent when the variable is
  unset, and present when set. The point is that `loadVmConfig` is the only
  reader of the environment.

Leave the `?? ''` empty-string fallback: `vmrun` fails with its own clear error
when the password is wrong or empty, and that is a better diagnostic than this
code inventing one. Say so in a comment.

## 7. Fix two comments that assert things nobody has verified

Both are the project's recurring defect in comment form: a confident sentence
about behaviour, where the behaviour is unconfirmed.

**`revert()`** says `start is idempotent, so call it either way`. Reverting to a
**live** snapshot — which is the design's whole reset mechanism, spec §4's
~5-second reset — leaves the VM *running*, and `vmrun start` on an
already-running VM is not known to succeed silently. Nobody has run it. The code
is fine as written (the result is ignored, and the VM ends up running either
way), so **do not change the code** — do not add a `vmrun list` probe, because
that is an extra round trip on the reset path the design advertises at ~5
seconds. Change the comment to state the truth: a live-snapshot revert may leave
the VM already running, in which case this `start` is expected to fail and its
failure is deliberately ignored; this is unverified against real `vmrun` and the
VM acceptance step is where it gets confirmed.

**`stop()`** says `soft = ACPI shutdown, so filesystems flush. hard would
corrupt the very persistence the graders check.` Both sentences are true and
worth keeping. Add the part Task 16 measured: `stop soft` requires
`open-vm-tools` running in the guest to acknowledge it, and against a guest
without it the call **hangs and never returns** — observed live, see
`docs/r1-findings.md`. Mandate 1's timeout is what bounds that; the comment
should point at it so the next reader knows the hang is handled rather than
unconsidered.

## 8. Make the transport-kind list impossible to drift, and leave the cast alone

```ts
const KINDS: readonly string[] = ['ssh', 'vmrun', 'fake']
```

Typed as `readonly string[]`, so adding a fourth member to `TransportKind` later
leaves this list stale and `RHCSA_TRANSPORT=<newkind>` gets rejected with a
message listing three kinds. Replace it with an exhaustive record, so the
omission becomes a compile error instead:

```ts
// Exhaustive by construction: adding a TransportKind fails to typecheck until
// it is listed here.
const KINDS: Record<TransportKind, true> = { ssh: true, vmrun: true, fake: true }
```

Use `Object.hasOwn(KINDS, forced)` for the check and `Object.keys(KINDS).join(', ')`
in the message. The existing test `rejects an unknown forced transport` must
still pass unchanged — confirm it does.

I compiled exactly this under the repo's own `tsconfig.json` before writing it
down, so you are not the first person to find out whether it works: it
typechecks clean (`Object.hasOwn` is available at this lib target), and adding a
fourth member to `TransportKind` produces

```
error TS2741: Property 'newkind' is missing in type '{ ssh: true; vmrun: true;
fake: true; }' but required in type 'Record<TransportKind, true>'.
```

which is the whole point of the change.

**Leave `forced as TransportKind | undefined` exactly as the brief writes it.**
It is a deliberate, already-established idiom here: five sites in `src/` do the
same thing (`src/engine/content/task.ts:96,101,107-108`,
`src/engine/grading/verdict.ts:29`, `src/engine/content/objectives.ts:70`),
all guarded by a membership check first, and all parked for one `oneOf`
type-predicate helper at the final whole-branch review. Introducing a bespoke
predicate here would leave two idioms in the tree and make that unification
harder. Do not "fix" it, and do not let it consume a review finding — it is
recorded as parked in the ledger.

## 9. The acceptance step cannot work as written

Step 7 runs:

```bash
node --input-type=module -e "…loadVmConfig(process.env)…"
```

Nothing in this project loads `.env.local` into `process.env`. `RHCSA_VMX` lives
there per `docs/vm-build-checklist.md` §6, so a reader who did exactly what §6
told them gets `RHCSA_VMX is not set. Put it in .env.local…` — an error telling
them to do the thing they already did. Every other VM-touching entrypoint in the
plan carries `--env-file-if-exists=.env.local` for precisely this reason.

Add the flag to Step 7's invocation:

```bash
node --env-file-if-exists=.env.local --input-type=module -e "…"
```

Confirmed working on this Node: it prints `.env.local not found. Continuing
without it.` when the file is absent and still exits 0. Keep the
`RHCSA_GUEST_PASSWORD` export note — a throwaway shell export is the documented
alternative to putting the password in the file, and either source now reaches
`loadVmConfig` through mandate 6.

**Step 7 stays deferred.** The RHEL VM does not exist; the ISO is a user-owned
blocker. Do not start, stop, snapshot, or revert any VM on this host — in
particular not the user's Ubuntu or Windows 11 VMs, which are unrelated to this
project. Mark the step deferred in your report and say what it will prove when
the VM exists.

## Out of scope

- Do not touch `content/`, `docs/`, `README.md`, or `package.json`. The npm
  scripts that carry `--env-file-if-exists` belong to a later task.
- Do not create or modify `.env.local`.
- Do not implement `SshTransport` or `chooseTransport` — Task 18 owns both. This
  task's contract with it is `VmrunConfigSlice`; keep it structural, and note in
  your report exactly which fields it now contains.
- No `sudo` on this WSL host: there is no TTY, it cannot authenticate, and
  nothing here needs it.
- Never read or copy `.env`, `.env.sandbox`, or `.env.example` from
  `/home/daxtangco/sechelp-tools` — an unrelated project's secrets.

## Verify before committing

1. `npx vitest run` and `npm run typecheck` both clean.
2. **Report the test count you observe; do not trust mine.** The brief predicts
   5 config + 13 vmrun tests. These mandates add tests (mandate 2 adds two,
   mandate 3 adds one) and rewrite one, so the number will differ. The branch
   was at 161 passing / 16 files before this task. State the new totals as
   measured.
3. Mandate 4's break-and-revert must actually have been run. Say so, and say
   what the failure looked like.
4. Grep your own diff for the password: `git diff | grep -n 'RHCSA_GUEST_PASSWORD'`
   should show it only in `config.ts` and in a test, never in `vmrun.ts`.
5. `git status --porcelain` empty after committing.

Report to `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-17-report.md`
as a real file. Include, per mandate, the observed test totals, the mandate-4
break-and-revert result, and the final field list of `VmrunConfigSlice` for
Task 18.
