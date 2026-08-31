# Task 18 review — `SshTransport` and transport selection

Reviewed: `2aff6aa..cb1a878` (`cb1a878` "feat(vm): SshTransport and automatic
transport selection"). Files: `src/engine/vm/ssh.ts` (new, 170 lines),
`src/engine/vm/select.ts` (new, 104 lines), `test/vm/ssh.test.ts` (new, 12
tests), `test/vm/select.test.ts` (new, 8 tests).

## Method

Read all four context documents first, then the diff. Rather than trust the
report's numbers or its account of the mandate-2 break-and-revert, I:

1. Ran `npx vitest run` and `npm run typecheck` myself on the committed tree.
2. Copied the tree to a scratch directory outside the repo
   (`/tmp/rhcsa-mut*`, `node_modules` symlinked back, deleted afterward) and
   mutated the *real, unmodified-otherwise* `src/engine/vm/ssh.ts` and
   `select.ts` there, one behavior at a time, running only the relevant test
   file against each mutant. This kept `git status --porcelain` on the actual
   working tree empty throughout — confirmed before and after.
4. Reverted or discarded each mutant before moving to the next.

Confirmed clean before starting and clean at the end:
`git status --porcelain` → empty, both times.

## Measured totals

```
npx vitest run
 Test Files  20 passed (20)
      Tests  203 passed (203)

npm run typecheck
> tsc --noEmit
(clean, exit 0, no output)
```

This matches the report's claimed 203/20 exactly (baseline 183/18 + 20 new:
12 in `ssh.test.ts`, 8 in `select.test.ts`). No discrepancy.

## Spec compliance — all seven mandates: SATISFIED

**1. `realSshRunner` timeout + 124 convention — SATISFIED.**
`makeSshRunner(opts)` (`src/engine/vm/ssh.ts:45`) defaults `timeoutMs` to
`120_000` and passes it to `execFile` as `timeout`. `realSshRunner` is still
exported with the same name and type (`ssh.ts:91`,
`export const realSshRunner: SshRunner = makeSshRunner()`), so
`SshTransport`'s constructor default still resolves correctly. The
timed-out branch (`ssh.ts:67-75`) checks `err.killed === true ||
(typeof err.code !== 'number' && !!err.signal)` *before* falling back to
`code ?? 1`, and returns `code: 124` with a stderr message naming what timed
out and after how long. `124` matches `vmrun.ts`'s `makeRunner` convention
exactly — same field shape, same threshold logic, verified by reading
`vmrun.ts:41-60` side by side with `ssh.ts:45-88`. A one-line comment
(`ssh.ts:41-43`) explains why no credential redaction is needed (key *path*
in argv, never a secret), as required.

Mutation-tested: changed `code: 124` to `code: 1` in the timeout branch on a
scratch copy. `reports a hung command as 124 rather than as a plain failure`
failed immediately and clearly: `AssertionError: expected 1 to be 124`.
Reverted.

**2. Real-runner stdin proof — SATISFIED, with a quality observation (see
below).** Two new tests exist under `describe('makeSshRunner /
realSshRunner')` that call the real `execFile` through `/bin/cat` and
`/bin/sh -c 'sleep 5'` — no `recorder()` mock. Independently reproduced the
break-and-revert myself (not trusting the report's account): commenting out
`child.stdin?.end(stdin)` on a scratch copy made `the real runner delivers
the script on the child stdin, not argv` hang and fail with `Test timed out
in 10000ms` — the same failure the report describes, reproduced from a cold
copy rather than assumed. Restored, reran, 12/12 pass in ~200ms.

**3. Pinned `fake` no longer silently discarded — SATISFIED, this is the
most important item and it holds.** `select.ts:87-93` throws before the
`pinned === 'ssh' || pinned === 'vmrun'` branch (`select.ts:95`), and the
message contains the literal string `RHCSA_TRANSPORT`
(`"...Unset RHCSA_TRANSPORT, or set it to ssh or vmrun."`). The new test
`refuses a pinned 'fake' transport instead of silently falling through to a
real one` asserts `.rejects.toThrow(/RHCSA_TRANSPORT/)`.

Mutation-tested: removed the `if (pinned === 'fake') { throw ... }` block
on a scratch copy. Result reproduced the exact pre-mandate bug described in
the mandates doc — `chooseTransport` **resolved** to
`FakeTransport{ kind: 'ssh' }` instead of rejecting, i.e. a pinned `fake`
silently became a live `ssh` transport. The test caught it precisely:
`promise resolved "FakeTransport{ kind: 'ssh', ... }" instead of rejecting`.
Reverted.

Confirmed `select.ts` imports only `./config.ts`, `./ssh.ts`,
`./transport.ts`, `./vmrun.ts` (`select.ts:1-4`) — no import from
`./fake.ts` (checked with `grep -n "'./fake"`, no match). Verified this is
the corrected property from the review-context note, not the broken literal
`grep -n "fake"` command (which necessarily matches the mandate's own
required code and comments, and does).

**4. `known_hosts` comment/design-note rewrite, code unchanged —
SATISFIED.** `ssh.ts:100-112`'s new comment correctly states: a snapshot
revert restores the guest's host keys and cannot change them; `accept-new`
would not rescue a changed key regardless; a rebuild from the ISO is what
actually invalidates a host key; and the dedicated file's real value is
confining a rebuild's fallout to a throwaway file rather than the user's
real `known_hosts`. The parallel test comment (`ssh.test.ts` around the
`UserKnownHostsFile` assertion) was updated to match the same corrected
rationale. Code verified byte-for-byte unchanged from the brief: same
`KNOWN_HOSTS` constant (`join(homedir(), '.ssh', 'rhcsa_known_hosts')`),
same options array, `accept-new` untouched.

**5. Marker check made load-bearing — SATISFIED, and it is the load-bearing
assertion the mandate asked for.** `isAvailable()` (`ssh.ts:157-169`)
returns `r.code === 0 && r.stdout.includes('rhcsa-probe')`. The brief's
first `isAvailable` fixture was changed to
`{ stdout: 'rhcsa-probe\n', ... }` as required, and the new
ForceCommand-style test (`isAvailable is false when ssh exits 0 but the
script never ran`) was added.

Mutation-tested: weakened the return to `r.code === 0` alone on a scratch
copy. The new ForceCommand test failed exactly as it should:
`AssertionError: expected true to be false`. All 11 other tests in the file
were unaffected — the marker conjunct is doing real work, not decorative.
Reverted.

**6. Step 7 deferred, no VM operation — SATISFIED.** The report states
plainly that Step 7 was not attempted, no VM operation of any kind was
performed on this or any other VM, and states what the deferred half will
prove (stopping `sshd` from the console should make `chooseTransport`
return `vmrun`). I performed no VM operations myself in the course of this
review, consistent with the out-of-bounds constraints. `--env-file-if-
exists=.env.local` was not added to Step 7's invocations, but since Step 7
was never run and its text is documentation rather than code under review
in this diff, this is moot until Task 19 unblocks the VM.

**7. Probe-ceiling comment extended, no behavior change — SATISFIED.**
`PROBE_TIMEOUT_MS`'s comment (`select.ts:53-66`) now states the concrete
cost of the 3s ceiling firing early — silent fallback to the ~3x-slower
`vmrun` path for the rest of the session — and notes the abandoned ssh probe
is not cancelled, running to completion under `makeSshRunner`'s own 120s
ceiling with its result discarded. The value is still `3000`.
`availableWithin` (`select.ts:69-81`) is structurally identical to the
brief's version — same `Promise.race`/`setTimeout`/`finally` shape, no
cancellation logic added.

## Structural checks (mandates' own "verify before committing" list)

- No `as` casts, no non-null `!` assertions entered `src/`. Confirmed via
  `grep -nE '\bas\b'` (only prose matches: "hands us as `err`", "as its
  last-resort recovery path") and a pattern for a trailing `!` after an
  identifier (no matches). `isExecFileError` (`ssh.ts:24-26`) narrows
  `unknown` with a type predicate instead.
- The predicate is genuinely extractable, not just claimed to be: I read
  `vmrun.ts:41-60` and its cast `e as { stdout?: string; stderr?: string;
  code?: number; killed?: boolean; signal?: string | null }` is
  field-for-field identical to `ssh.ts`'s new `ExecFileError` interface.
  Confirms the report's claim that a future whole-branch pass can move
  `vmrun.ts:49` onto this predicate as a straight swap.
- `config.ts`, `vmrun.ts`, `transport.ts`, `fake.ts` untouched — confirmed,
  diff touches only the four files listed at the top.
- `TransportKind = 'ssh' | 'vmrun' | 'fake'` and `VmConfig.forceTransport?:
  TransportKind` with `config.ts`'s exhaustive `KINDS` record confirmed by
  reading `config.ts` and `transport.ts` directly — mandate 3's premise
  (a pinned `fake` is genuinely reachable through `RHCSA_TRANSPORT`) is real,
  not hypothetical.
- `git status --porcelain` empty, both before I started and after I
  finished.

## Task quality verdict

Good. Judged as the person debugging a grader that returned exit 1 at 1am:
the code gives that person exactly what they need. `124` is unambiguous and
distinguished from a script's own `exit 1` and from ssh's own connection-
refused codes; the timeout stderr names what timed out and the ceiling that
fired; the `fake`-pin error names the exact environment variable to unset;
`NoTransportError` (unchanged from the brief) names both transports tried
and points at the two troubleshooting docs. Comments accurately reflect
measured behavior (`ssh_config(5)`'s actual `accept-new` semantics, `execFile`
timeout semantics) rather than the brief's original, factually wrong
justification — and the code that comments describe was left alone exactly
as mandate 4 required, so there's no drift between prose and behavior.

One finding, ranked below. No must-fix items — nothing here blocks.

### Findings

**1. [observation] Mandate 2's stdin-delivery test fails slowly (10s vitest
timeout) rather than loudly, and a low-cost fix exists.**

Confirmed independently (own mutation, not just the report's account) that
removing `child.stdin?.end(stdin)` makes `the real runner delivers the
script on the child stdin, not argv` hang for the full 10s default test
timeout before failing. The context flagged this exact weakness in advance
and asked whether the test should assert differently.

I tested a concrete fix on a second scratch copy: passing an explicit short
`timeoutMs` to `makeSshRunner()` in *this one test* —
`makeSshRunner({ timeoutMs: 500 })('/bin/cat', [], 'hello-from-stdin\n')`
instead of `makeSshRunner()('/bin/cat', ...)`. With the stdin-write mutation
still applied, the same defect now surfaces in ~700ms as a clear, ordinary
assertion failure: `AssertionError: expected 124 to be 0`. With the
stdin-write intact (i.e. against the real, correct code), the test still
passes in ~200ms — `cat` receives EOF immediately and finishes well under
500ms, so the tighter timeout has no effect on the passing case. This uses
a mechanism `makeSshRunner` already exposes for exactly this purpose; it is
not a new capability.

This is not a mandate-compliance defect — the test as committed is
probative, its failure was observed and reported by hand exactly as
mandate 2 required, and 10 extra seconds in a ~700ms suite is a nuisance,
not a correctness gap. Recommend picking it up as a small follow-up rather
than blocking on it.

## Out-of-bounds and pre-cleared items — not re-raised

Per the review context: did not touch `vmrun.ts:49`'s parked cast, did not
re-litigate the `child.stdin` post-exit-write or `Promise.race` late-
rejection items (both previously measured as not defects), did not perform
any VM operation, did not read `.env*` files from the sechelp-tools project,
and did not flag the implementer's substituted `grep -n "'./fake"` check in
place of the review context's own broken `grep -n "fake"` — that
substitution is correct and was pre-cleared.

## Verdict summary

- **Spec compliance:** all seven mandates satisfied, each independently
  verified by mutation testing on a scratch copy of the real module (not
  code reading alone) plus direct reading of the surrounding files
  (`config.ts`, `transport.ts`, `vmrun.ts`) the mandates depend on.
- **Task quality:** good. One observation-level finding (mandate 2's test
  fails slowly, fix available, not blocking).
- **Blocking:** nothing blocks.
- **Measured totals:** 203 passing / 20 files; `npm run typecheck` clean.
  Matches the report exactly, independently confirmed.
