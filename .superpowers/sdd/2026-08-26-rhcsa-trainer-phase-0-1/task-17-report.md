# Task 17 report — `VmrunTransport` and VM lifecycle

**Status: DONE**
**Commit:** `2aff6aa73b3543d71095257431dc3bcb1aa462c4`

## Files

- `src/engine/vm/config.ts` (new)
- `src/engine/vm/vmrun.ts` (new)
- `test/vm/config.test.ts` (new)
- `test/vm/vmrun.test.ts` (new)

## Measurements I ran myself before implementing

The mandates carry a measurement warning; I confirmed each claim independently
rather than trusting the pasted output, on this same host, `node v22.23.2`:

1. **argv leak on execFile failure** — ran the exact `/bin/false -gp
   SUPERSECRET x` case: `err.message` was
   `"Command failed: /bin/false -gp SUPERSECRET x\n"`, `code: 1`, `stderr: ""`.
   Matches the mandate exactly — confirms `err.stderr` is empty here, so the
   fallback path (not `err.stderr`) is what would leak the password.
2. **Timeout `code` is `null`, `killed` is `true`** — ran `/bin/sh -c "sleep
   5"` with `timeout: 200`: got `code: null`, `killed: true`,
   `signal: "SIGTERM"`, after 206ms. Matches.
3. **`--env-file-if-exists=.env.local`** — ran it with no `.env.local`
   present: printed `.env.local not found. Continuing without it.` to stderr,
   exited 0. Matches.
4. **`Record<TransportKind, true>` exhaustiveness** — compiled a standalone
   file adding a `newkind` member to a local `TransportKind` copy under
   `--strict --target ES2023 --module NodeNext --moduleResolution NodeNext`:
   got exactly `error TS2741: Property 'newkind' is missing in type '{ ssh:
   true; vmrun: true; fake: true; }' but required in type
   'Record<TransportKind, true>'.` Matches.

All four of my own measurements agreed with the mandates' pasted numbers, so
I implemented the mandates as written; no disagreement to report.

## Test totals (observed, not predicted)

Before this task: **161 tests / 16 files** (confirmed by running `npx vitest
run` prior to touching anything).

After this task: **183 tests / 18 files** — `npx vitest run` output:

```
Test Files  18 passed (18)
     Tests  183 passed (183)
```

That's +22 tests across the 2 new files (`test/vm/config.test.ts`: 6,
`test/vm/vmrun.test.ts`: 16), against the brief's prediction of 5 config + 13
vmrun = 18. The delta from the brief's own number is +1 config test
(mandate 6's guest-password presence/absence test) and +3 vmrun tests
(mandate 2's two `makeRunner` tests, mandate 3's host-failure test), plus
mandate 4's rewrite of the "reboot waits" test (same count, different body).
5+1=6, 13+3=16, 6+16=22. Matches what mandates 2/3/6 predicted adding.

`npm run typecheck` — clean, no output, exit 0.

## Mandate 4: break-and-revert, actually run

Edited the live test file, changed `probes <= 2` to `probes <= 1` in "reboot
polls until the guest answers, rather than sleeping once", and ran just that
test:

```
× VmController > reboot polls until the guest answers, rather than sleeping once
AssertionError: expected 2 to be 3 // Object.is equality
- Expected: 3
+ Received: 2
```

That is the correct failure mode: with the bad boundary, `waitForGuest`'s
first probe (probe 2) already reports "up" (since `probes <= 1` now excludes
probe 2), so `reboot()` returns after only 2 `runProgramInGuest` calls instead
of 3 — the test would have passed even if `reboot()` slept once and accepted
the first answer, for a slightly different (now off-by-one) reason, which is
exactly the failure-for-the-wrong-reason mandate 4 describes. I then restored
the file from a pre-edit copy (`cp` back, not a git-tracked revert since the
file wasn't committed yet) and reran the full suite to confirm 183/183 passed
again before committing.

## Mandate-by-mandate

1. **Runner timeout, distinct 124 on hang.** `makeRunner(opts)` exported,
   defaults `timeoutMs` to `120_000`, passes `timeout` to `execFile`.
   `realRunner = makeRunner()` keeps the original exported name/type. Timeout
   detection: `err.killed === true || (typeof err.code !== 'number' &&
   !!err.signal)`, returning `code: 124` and a `stderr` naming what timed out
   and after how long.
2. **Redaction.** `redactArgv` replaces the value following `-gp` with
   `<redacted>`. `makeRunner`'s catch path prefers `err.stderr` when non-empty
   and only falls back to a redacted rebuild of the `Command failed: <exe>
   <argv>` shape otherwise — `err.message` is never read. `guestAuth` carries
   a comment stating plainly that vmrun has no other interface for the guest
   password, so it is visible in the host process list for the call's
   duration, and that this is inherent to vmrun, not fixable here. Both
   mandate-2 tests pass against the real `/bin/false` and `/bin/sh` (present
   on this host; neither needed adapting).
3. **`reboot()` no longer swallows host rejections.** Dropped the
   `.catch(() => undefined)` off `t.exec(...)` in `reboot()`. Comment above it
   now explains the result/rejection distinction. New test ("surfaces a
   host-side failure instead of waiting out the guest timeout") passes.
4. **Reboot test rewritten and break-verified** — see above. Final version
   counts only `runProgramInGuest`, fails probes 1–2, and asserts
   `probes === 3` exactly.
5. **`guestScriptPath()` uses `randomBytes(6).toString('hex')`** from
   `node:crypto`, no counter. Confirmed the existing regex assertion
   `/^\/tmp\/rhcsa-[a-z0-9]+\.sh$/` still holds (hex is `[0-9a-f]+`, a subset
   of `[a-z0-9]+`) — test passes. Comment rewritten to state the cross-process
   collision risk this fixes (server + CLI staging against the same guest)
   rather than the old, only-locally-true claim.
6. **`guestPassword` moved into config.** Added `guestPassword?: string` to
   both `VmConfig` and `VmrunConfigSlice`. `loadVmConfig` populates it from
   `env.RHCSA_GUEST_PASSWORD`; `guestAuth` reads `cfg.guestPassword ?? ''`.
   No `process.env` read anywhere in `vmrun.ts` now — confirmed by grep (see
   below). Brief's `CFG` test literal (no `guestPassword` field) still
   satisfies `VmrunConfigSlice` structurally since the field is optional — the
   existing vmrun tests using bare `CFG` compiled and passed unchanged. Config
   test added per the mandate's instruction: asserts absence when unset and
   presence (via `toBeDefined()`, not a literal round-trip) when set.
7. **Comments on `revert()` and `stop()` corrected**, no code changes to
   either. `revert()`'s comment now says a live-snapshot revert may leave the
   VM already running (so `start` failing there is expected and ignored,
   unverified against real vmrun). `stop()`'s comment keeps the two original
   true sentences and adds the `open-vm-tools`-required hang observed in
   `docs/r1-findings.md`, pointing at mandate 1's timeout as what bounds it.
8. **Exhaustive `Record<TransportKind, true>`** replaces the `readonly
   string[]` list; `Object.hasOwn(KINDS, forced)` for the check,
   `Object.keys(KINDS).join(', ')` for the message. Compiled clean per my own
   measurement above. Left `forced as TransportKind | undefined` untouched, as
   instructed — did not introduce a bespoke type predicate.
9. **Step 7 acceptance stays deferred.** RHEL VM does not exist; ISO is a
   user-owned blocker. Did not start, stop, snapshot, or revert any VM on this
   host — the two existing VMs (Ubuntu, Windows 11) belong to the user and are
   untouched. Noting for the record what Step 7 will prove once the VM exists
   and the `--env-file-if-exists=.env.local` flag is added to its invocation:
   `isAvailable()` true against the real `vmrun list`, a real guest `exec`
   returning hostname/`student`/`Enforcing`, and `listSnapshots()` containing
   `golden`.

## Verification checklist

1. `npx vitest run` and `npm run typecheck` both clean — see totals above.
2. Test totals reported as observed: 183 passed / 18 files (161/16 baseline
   + 22 new).
3. Mandate 4's break-and-revert was actually run; failure output captured
   above.
4. `grep -rn 'RHCSA_GUEST_PASSWORD' src/engine/vm/ test/vm/` shows it only in
   `src/engine/vm/config.ts` (one line, populating the field) and
   `test/vm/config.test.ts` (one line, a test input) — never in `vmrun.ts`.
   (`git diff` shows nothing for these since all four files are new/untracked,
   not modifications to tracked files — used a direct grep against the new
   files instead, which is the artifact that actually matters here.)
5. `git status --porcelain` is empty after the commit.

## `VmrunConfigSlice` — final field list, for Task 18

```ts
export interface VmrunConfigSlice {
  vmx: string
  vmrun: string
  sshUser: string
  guestPassword?: string
}
```

Structural, as required — `VmConfig` (which Task 18's `chooseTransport(cfg:
VmConfig, opts?)` will take whole) satisfies this by having all four fields;
adding `guestPassword` as optional did not break the brief's bare-literal
`CFG` test object in `test/vm/vmrun.test.ts`, which has no `guestPassword`
key at all.

## Concerns

None. Both of my own pre-implementation measurements and the break-and-revert
exercise came back exactly as the mandates predicted; no disagreement to
flag, and no scope (SshTransport, chooseTransport, content/docs/README/
package.json, `.env.local`, sudo) was touched.
