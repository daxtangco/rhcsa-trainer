# Task 18 — reviewer context

Read `task-18-brief.md` and `task-18-mandates.md` first. **The mandates override
the brief wherever they conflict** — seven numbered required changes. Spec
compliance means compliance with the mandates, not with the brief's original
code.

## Two verdicts are required

Neither is optional and neither substitutes for the other:

1. **Spec compliance** — each of the seven mandates: satisfied, or not, with
   evidence. Name the file and line you checked.
2. **Task quality** — judge the code as the person who will debug a grader that
   returned "exit 1" at 1am and has to work out whether the script failed or the
   connection wedged. That is the audience mandate 1 was written for.

## Three things that are load-bearing

**Mandate 3 — the silent `fake` fallthrough — is the most important item in this
task.** `RHCSA_TRANSPORT=fake` is an *accepted* value in Task 17's
`loadVmConfig` (its `KINDS` record is exhaustive over `TransportKind`, which
includes `fake`), and the brief's `chooseTransport` tested only
`pinned === 'ssh' || pinned === 'vmrun'` — so a pinned `fake` fell through and
the caller silently received a live `SshTransport` against their real VM. Verify
the throw happens **before** the ssh/vmrun branch, that its message names
`RHCSA_TRANSPORT` (a reader who set an env var needs to be told which one to
unset), and that a test asserts both the throw and the message.

**Mandate 2 — the stdin test — closes a check that passed for the wrong
reason.** All nine of the brief's ssh tests use a `recorder()` mock, so they
prove `SshTransport` *hands* the script to its runner and prove nothing about
whether `realSshRunner` writes it to the child. The implementer reports that
breaking `child.stdin?.end(stdin)` made the new test **hang and hit vitest's 10 s
timeout** rather than fail an assertion — `/bin/cat` with no stdin and no EOF
blocks forever. That is a legitimate observed failure, but satisfy yourself the
test is probative on your own terms: a test whose failure mode is "the suite
takes 10 s longer" is weaker than one that fails loudly, and if you think it
should assert differently, say so as a quality finding.

**Mandate 1 — the 124 convention.** `execFile`'s `code` is `null` on a killed
child (`killed: true`, `signal` set), so the brief's
`typeof code === 'number' ? code : 1` reported a two-minute hang as a plain
exit 1. Confirm `124` is returned on timeout, that `realSshRunner` is still
exported with the same name and type (`SshTransport`'s constructor defaults to
it), and that `124` matches what `vmrun.ts`'s `makeRunner` already returns —
one meaning for one number across the project.

## Do not re-raise these two — I measured both as NOT defects

Recorded in the mandates' own "measured as NOT defects" section. Both look like
bugs and are not. Do not spend a finding on either:

1. **Writing to `child.stdin` after the child exited does not crash the
   process.** Measured: `execFile('/bin/false')`, 150 ms wait, then
   `child.stdin.end(<4 MB>)` under an `uncaughtException` watcher — no
   synchronous throw, no uncaught exception. `child.stdin?.end(stdin)` needs no
   `'error'` handler.
2. **A late rejection from the losing side of `Promise.race` is not an unhandled
   rejection.** `Promise.race` subscribes to every input promise, so the loser's
   rejection is absorbed. Measured with a promise rejecting at 100 ms against a
   timeout resolving at 10 ms under an `unhandledRejection` watcher — nothing
   fired. `availableWithin` is correct as written.

If you disagree, measure it and show the command. Assertion alone will not
reopen either.

## My verification item 4 was wrong — the implementer was right

I told the implementer to confirm `grep -n "fake" src/engine/vm/select.ts`
returns nothing. It cannot: mandate 3's own required code contains
`pinned === 'fake'`. The implementer flagged this and substituted the check that
actually matters — that `select.ts` has no `import` from `./fake.ts`. **That
substitution was correct.** Verify the property, not my broken command: test
scaffolding must not be imported into the production selector, and `select.ts`'s
imports should be only `./config.ts`, `./ssh.ts`, `./transport.ts`, `./vmrun.ts`.
Do not report the implementer's deviation here as a finding.

## Mandate 4 is comment-only — the code must not have changed

The known_hosts justification in the brief was factually false: a snapshot revert
*restores* host keys and cannot change them; what changes them is rebuilding the
VM; and `accept-new` "will not permit connections to hosts with changed host
keys" (`ssh_config(5)` on this host), so it does not rescue a changed key anyway.
The mandate required the **comment and design note** to be rewritten and the
code — the constant, the option, `accept-new` — left exactly as the brief wrote
it. Check both halves: that the prose now says the dedicated file's real value is
confining a rebuild's failure to a throwaway file, and that no behaviour moved.
Mandate 7 (`PROBE_TIMEOUT_MS`) is comment-only in the same way: the timeout must
still be 3000 and no cancellation may have been added.

## Mutation testing is the standard here, not code reading

Every reviewer on this branch has been asked to break things and revert. Where a
seam exists, **prefer a standalone script that imports the real unmodified module
through its injected seam** over editing the tree — `SshTransport` takes an
`SshRunner` and `chooseTransport` takes `{ssh, vmrun}`, so both are reachable
without touching a file. Pick the assertions that carry weight — the 124 test,
the `rhcsa-probe` marker check, the `fake` throw, the ForceCommand case — and
confirm each fails when the behaviour it guards is removed. A test that still
passes with the behaviour gone is a finding.

Mandate 5's marker check is the subtle one: `isAvailable` must require
`r.code === 0 && r.stdout.includes('rhcsa-probe')`. Drop the second conjunct and
the new ForceCommand test should fail. If it does not, the test is not doing its
job.

## Out of bounds

- **No VM operations.** The RHEL VM does not exist (user-owned ISO blocker), and
  the user's Ubuntu and Windows 11 VMs are unrelated to this project: do not
  start, stop, snapshot, or revert any VM. Do not stop `sshd` anywhere. Step 7 is
  deferred by mandate 6; confirm the implementer marked it deferred rather than
  attempting it, and that its report says what the deferred half will prove.
- **No `sudo`** on this WSL host — there is no TTY, it cannot authenticate, and
  nothing here needs it.
- **Never read or copy** `.env`, `.env.sandbox`, or `.env.example` from
  `/home/daxtangco/sechelp-tools` — an unrelated project's secrets.
- Do not create, read, or modify `.env.local`.
- `src/engine/vm/config.ts`, `vmrun.ts`, `transport.ts`, and `fake.ts` are owned
  by closed tasks and were correctly left alone. In particular **`vmrun.ts:49`'s
  catch-narrowing cast is parked, not a Task 18 finding** — mandate 1's new
  `isExecFileError` predicate is deliberately generic so the final whole-branch
  review can move that site onto it. Do not report the two idioms coexisting.
- Untracked files belonging to a later task may appear in the tree while you
  work. They are not this task's leakage; judge only the diff you were given.

## Baseline

The branch was at **183 passing / 18 files** at `2aff6aa`. The implementer
reports **203 passing / 20 files** at `cb1a878`. Run `npx vitest run` and
`npm run typecheck` yourself and report the totals you observe; do not repeat the
implementer's numbers without measuring. If your totals differ from theirs, say
so — that discrepancy would itself be the finding.

Note the implementer's arithmetic note: the brief predicted 16 tests, the
mandates add 4 net (mandate 2 adds two, mandate 3 one, mandate 5 one plus a
fixture edit), giving 20. My own mandate text said "three", which was wrong;
20 is the right number and their accounting is correct.

## Report

Write the full review to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-18-review.md` and
return only: both verdicts, the findings ranked by severity, whether anything
blocks, and the totals you measured. Mark each finding **must-fix**,
**observation**, or **forward-to-later**.
