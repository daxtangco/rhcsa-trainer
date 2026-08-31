# Task 17 review — `VmrunTransport` and VM lifecycle

Reviewed: commit `2aff6aa` (range `5c7f650..2aff6aa`), against `task-17-brief.md`,
`task-17-mandates.md` (9 required changes), and `task-17-review-context.md`.

## Re-derived measurements (own commands, this host, node v22.23.2)

```
LEAK-TEST message: "Command failed: /bin/false -gp SUPERSECRET x\n"
  code: 1  stderr: ""
TIMEOUT-TEST after 209 ms
  message: "Command failed: /bin/sh -c sleep 5\n"
  code: null  killed: true  signal: SIGTERM
```

Both match the mandates' pasted numbers and the implementer's independently-run
numbers exactly. No disagreement — mandates 1 and 2 rest on solid ground.

Test totals, run myself: `npx vitest run` → **183 passed / 18 files**. Baseline
was 161/16, so +22, matching the report's arithmetic (config +1, vmrun +3, plus
mandate 4's same-count rewrite). `npm run typecheck` → clean, exit 0.

`git diff 5c7f650..2aff6aa | grep -n RHCSA_GUEST_PASSWORD` → two hits, both
expected: `config.ts` (populating the field) and `config.test.ts` (a test
input). Zero hits in `vmrun.ts` or `vmrun.test.ts` — confirmed directly (not
via the report's grep, which used a live-tree grep instead of `git diff` for a
reason the report gives that is itself wrong — see Observations).

## Verdict 1 — Spec compliance (9 mandates)

**All nine satisfied. No must-fix findings against the mandates.**

1. **Runner timeout / 124 on hang — PASS.** `makeRunner()` (`vmrun.ts:39`)
   exported, defaults `timeoutMs` to `120_000` (`:40`), passed as `timeout` to
   `execFileAsync` (`:45`). Timeout detection `err.killed === true ||
   (typeof err.code !== 'number' && !!err.signal)` (`:60`) returns `code: 124`
   with a stderr naming what timed out and after how long (`:61-67`).
   `realRunner = makeRunner()` keeps the name/type stable (`:88`). Both new
   tests (`vmrun.test.ts:463-473`) pass in the real run.
2. **Redaction — PASS.** `redactArgv` (`vmrun.ts:23-28`) replaces the value
   after `-gp`. Catch path prefers `err.stderr` when non-empty, else a redacted
   rebuild (`:73-76`); `err.message` is never read anywhere in the file
   (confirmed by grep — the only reference to a raw message is the removed
   one). `guestAuth`'s comment states the argv-exposure fact plainly
   (`:98-106`). Both mandated tests present verbatim and pass.
3. **`reboot()` no longer swallows host rejections — PASS.** The
   `.catch(() => undefined)` is gone; `vmrun.ts:288` is a bare
   `await t.exec(...)`. Comment extended to explain the result/rejection
   distinction (`:277-285`). New test (`vmrun.test.ts:628-634`) passes.
4. **Reboot test rewritten and break-verified — PASS.** Test body
   (`vmrun.test.ts:603-620`) matches the mandate exactly: counts only
   `runProgramInGuest`, fails probes 1-2, asserts `probes === 3`. I
   independently reproduced the break-and-revert **without touching any file**,
   using the injected `Runner` seam against the real, unmodified
   `VmController`: with the boundary at `probes <= 1` (the implementer's
   claimed break) I measured `probes === 2`, so `expect(probes).toBe(3)` would
   fail exactly as the report describes (`expected 2 to be 3`). With the real
   `probes <= 2` boundary I measured `probes === 3`. This corroborates the
   report's break-and-revert claim from an independent script, not a repeat of
   their number.
5. **`guestScriptPath` collision fix — PASS.** `randomBytes(6).toString('hex')`
   (`vmrun.ts:116`), no counter. Comment rewritten to state the real
   cross-process collision risk (`:112-115`). The existing regex assertion
   `/^\/tmp\/rhcsa-[a-z0-9]+\.sh$/` is unchanged and passes (hex ⊂ `[a-z0-9]`).
6. **Guest password moved into config — PASS.** `guestPassword?: string` added
   to `VmConfig` (`config.ts`) and `VmrunConfigSlice` (`vmrun.ts:95`).
   `loadVmConfig` populates it from `env.RHCSA_GUEST_PASSWORD`; `guestAuth`
   reads `cfg.guestPassword ?? ''` (`vmrun.ts:108`). Zero `process.env` reads in
   `vmrun.ts` — confirmed directly. New config test asserts absence/presence,
   not a literal round-trip, matching the mandate's explicit instruction
   (`config.test.ts:425-430`).
7. **Comments corrected, no code changes — PASS.** `revert()`'s comment
   (`vmrun.ts:237-241`) now states the live-snapshot-already-running case is
   unverified and `start`'s failure there is expected/ignored either way.
   `stop()`'s comment (`:223-228`) keeps both original true sentences and adds
   the `open-vm-tools`-hang observation, citing `docs/r1-findings.md` (verified
   this file exists and does record `"$VMRUN" stop "$VMX" soft # never
   returned"`) and pointing at mandate 1's timeout as the bound. No code
   changed in either method, as required.
8. **Exhaustive `Record<TransportKind, true>` — PASS.** Replaces the
   `readonly string[]` list; `Object.hasOwn(KINDS, forced)` for the check,
   `Object.keys(KINDS).join(', ')` for the message (`config.ts`). The existing
   "rejects an unknown forced transport" test is unchanged and passes.
   `forced as TransportKind | undefined` is preserved byte-for-byte
   (`config.ts` return statement) — correctly **not** "fixed," per the
   context file's explicit instruction not to spend a finding here.
9. **Step 7 deferred — PASS.** No VM operations were performed (confirmed: the
   diff contains no execution of the new classes, only their definitions and
   fake-runner-backed tests). Report states the deferral and what Step 7 will
   prove once the RHEL VM exists, satisfying the requirement to address this
   in the report.

## Verdict 2 — Task quality

**Good.** Judged as the person debugging a wedged `vmrun` call at 1am:

- The timeout mandate is the centerpiece and it lands well: a hang now reports
  `124` with a message naming the executable and the bound, instead of a bare
  `1` indistinguishable from a normal failure. That is exactly the diagnostic
  this task exists to add.
- `reboot()` no longer masking a missing `vmrun.exe` behind a 120s guest-wait
  timeout is a real debugging-time win — the error now points at the host, not
  the guest, which is where the actual problem is.
- Comments are honest about what is verified versus assumed (`revert`'s
  live-snapshot case, `stop`'s hang) rather than asserting untested behaviour
  as fact — this is the project's own recurring defect pattern, and this diff
  avoids it.
- The redaction path is narrowly scoped to the one place a secret can leak
  (`-gp` in argv) and is tested against the real `execFile`, not just a fake.

### Observations (non-blocking)

- **A second `as` cast exists that the stated "no casts except one" rule
  doesn't account for.** `vmrun.ts:49`, `const err = e as { stdout?: string;
  stderr?: string; code?: number; killed?: boolean; signal?: string | null
  }`, is a second, unguarded `as` cast — distinct in kind from the
  membership-checked `forced as TransportKind | undefined` idiom mandate 8
  preserves. It is inherited unchanged from the brief's own `realRunner`
  (brief line 337 used the same pattern) and no mandate touches it, so it is
  not a regression introduced by this task — but the global constraint as
  stated to me ("no `as` casts... except the one... mandate 8 preserves")
  is not literally true of the file as written. Worth a note for whoever
  reconciles the project's cast ledger; not a task-17 defect. **forward-to-later**
- **`mkdtemp`'s directory is not cleaned up if `writeFile` throws.**
  `vmrun.ts` `exec()`: `mkdtemp` and `writeFile` both run *before* the
  `try/finally` that does the `rm(dir, ...)` cleanup. If `writeFile` fails
  (disk full, permissions), the staged host temp dir leaks. Pre-existing in
  the brief's own code, unchanged by any mandate, low-likelihood host failure.
  **forward-to-later**
- **The `124`/"timed out" label covers any signal-kill, not only a real
  timeout expiry.** `err.killed === true` also fires if something external
  sends the child a signal for a reason unrelated to `makeRunner`'s own
  `timeout` option. The message would then say "timed out after Nms" for a
  kill that wasn't a timeout. Narrow edge case, not reachable through this
  module's own code paths today. **observation**
- **The report's justification for using a live grep instead of `git diff` is
  wrong, though its conclusion isn't.** The report says `git diff` "shows
  nothing for these since all four files are new/untracked" — but at the time
  of the actual commit these files are new-file additions in a real `git
  diff <base>..<head>`, which absolutely surfaces them (I ran exactly that
  and got two matching lines). The grep-based check the implementer actually
  ran gave the right answer for the wrong stated reason. **observation**

## Nothing blocks.

Both verdicts pass. No must-fix findings. Three forward-to-later/observation
notes above, none of which were introduced by this task's mandates and none of
which affect the nine required changes.
