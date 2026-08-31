# Task 17 — reviewer context

Read `task-17-brief.md` and `task-17-mandates.md` first. **The mandates override
the brief wherever they conflict** — nine numbered required changes. Spec
compliance means compliance with the mandates, not with the brief's original
code.

## Two verdicts are required

Neither is optional and neither substitutes for the other:

1. **Spec compliance** — each of the nine mandates: satisfied, or not, with
   evidence. Name the file and line you checked.
2. **Task quality** — judge the code as the person who will debug a wedged
   `vmrun` call at 1am with the trainer hung and no diagnostic. That is the
   audience the timeout mandate was written for.

## Re-derive the two measurements the mandates rest on

Mandates 1 and 2 exist entirely because of two claims I measured on this host.
If either is wrong, both mandates are wrong. Check them yourself with your own
command rather than trusting the numbers in the mandate file:

- `execFile`'s rejection message echoes the **full argv**, so a failed
  `vmrun … -gp <password> …` call puts the guest password into the error
  message. I measured `"Command failed: /bin/false -gp SUPERSECRET x\n"`.
- On timeout, the rejection's `code` is **`null`**, not a number — with
  `killed: true` and `signal: "SIGTERM"`. That is why the brief's
  `typeof err.code === 'number' ? err.code : 1` reported a two-minute hang as a
  plain exit 1.

If your measurement disagrees with mine, yours wins. Say so and review against
yours.

## Two things that are load-bearing and easy to get wrong

**Mandate 8 deliberately PRESERVES `forced as TransportKind | undefined`.** It is
an established idiom in this tree: five other sites do the same thing
(`src/engine/content/task.ts:96,101,107-108`,
`src/engine/grading/verdict.ts:29`, `src/engine/content/objectives.ts:70`), each
guarded by a membership check first, and all six are parked in the ledger for a
single `oneOf` type-predicate helper at the final whole-branch review.
Introducing a bespoke predicate here would leave two idioms in the tree and make
that unification harder. **Do not report it as a finding.** What mandate 8 *does*
require is the `Record<TransportKind, true>` + `Object.hasOwn` replacement for
the old `readonly string[]` list — check that, and check that adding a fourth
`TransportKind` member would now fail to typecheck.

**Mandate 4 rewrote a test that passed for the wrong reason.** The brief's
"reboot waits" test asserted `probes > 2`, but `reboot()`'s own `exec` fires two
`vmrun` calls before `waitForGuest` runs at all — so the assertion was satisfied
by `waitForGuest` succeeding on its *first* attempt, and the test never
demonstrated polling. The mandate counts only `runProgramInGuest`, fails the
first two, and asserts `expect(probes).toBe(3)`.

The mandate required the implementer to **break it and watch it fail** (change
`probes <= 2` to `probes <= 1`) and to report that they did. Confirm the report
says so, and satisfy yourself the assertion genuinely fails when the fake's
threshold moves — the whole point of the rewrite is a test whose failure has
been observed. A test whose failure nobody has seen is not yet a test.

## Mutation testing is the standard here, not code reading

Every reviewer on this branch has been asked to break things and revert. Pick the
assertions that matter — the redaction test, the 124 test, the polling count, the
`Object.hasOwn` membership check — and confirm each one fails when you break the
code it guards. A test that still passes with the behaviour removed is a finding.

## Out of bounds

- **No VM operations.** The RHEL VM does not exist (user-owned ISO blocker), and
  the user's Ubuntu and Windows 11 VMs are unrelated to this project: do not
  start, stop, snapshot, or revert any VM. Step 7 of the brief is deferred by
  mandate 9; confirm the implementer marked it deferred rather than attempting it.
- **No `sudo`** on this WSL host — there is no TTY, it cannot authenticate, and
  nothing here needs it.
- **Never read or copy** `.env`, `.env.sandbox`, or `.env.example` from
  `/home/daxtangco/sechelp-tools` — an unrelated project's secrets.
- Do not create or modify `.env.local`.

## Baseline

The branch was at **161 passing / 16 files** before this task. The mandates add
three tests and rewrite one, so the total must differ. Report the totals you
observe from your own `npx vitest run`; do not repeat the implementer's numbers
without running it.

Also confirm, per mandate 4 of the verification list:
`git diff <BASE>..<HEAD> | grep -n 'RHCSA_GUEST_PASSWORD'` shows it only in
`src/engine/vm/config.ts` and a test — **never** in `src/engine/vm/vmrun.ts`.
That is the whole point of mandate 6: `loadVmConfig` is the only reader of the
environment, so `Runner` really is the single injection seam.

## Report

Write the full review to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-17-review.md` and
return only: both verdicts, the findings ranked by severity, whether anything
blocks, and the totals you measured. Mark each finding **must-fix**,
**observation**, or **forward-to-later**.
