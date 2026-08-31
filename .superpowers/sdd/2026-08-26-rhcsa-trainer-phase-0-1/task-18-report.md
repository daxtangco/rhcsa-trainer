# Task 18 report — `SshTransport` and transport selection

## Status: complete

Both the brief's steps and all seven mandates were implemented. Step 7
(VM acceptance) is **deferred** per mandate 6 — no VM operation of any kind
was performed, and no VM on this host was touched.

## Commit

`cb1a878` — "feat(vm): SshTransport and automatic transport selection"

Files added: `src/engine/vm/ssh.ts`, `src/engine/vm/select.ts`,
`test/vm/ssh.test.ts`, `test/vm/select.test.ts`. `git status --porcelain` is
empty after the commit.

## Observed test totals (measured, not predicted)

```
npx vitest run
Test Files  20 passed (20)
     Tests  203 passed (203)
```

Baseline reported after Task 17 was 183 passing / 18 files. New:
`test/vm/ssh.test.ts` (12 tests) + `test/vm/select.test.ts` (8 tests) = 20 new
tests, 2 new files → 203/20, which matches 183+20 and 18+2 exactly.

Breakdown against the brief's own prediction: brief predicted 9 ssh + 7
select = 16. Mandates added 3 as stated (mandate 2: +2 real-runner tests,
mandate 3: +1 fake-pin test, mandate 5: +1 ForceCommand test but *replaces*
one brief assertion rather than adding a net test — net effect was +1, not
+2, since mandate 5's added test is separate from the fixture edit). Actual:
12 ssh (9 brief + 2 mandate-2 + 1 mandate-5) + 8 select (7 brief + 1
mandate-3) = 20. This differs from a naive "brief 16 + 3 = 19" because
mandate 5 contributes one new test in addition to editing a fixture, not
instead of it — consistent with the mandates' own text.

`npm run typecheck` → clean, no output, exit 0.

## Mandate 2 break-and-revert

I commented out `child.stdin?.end(stdin)` in `src/engine/vm/ssh.ts` and ran
`npx vitest run test/vm/ssh.test.ts`.

**Observed failure:** the test `makeSshRunner / realSshRunner > the real
runner delivers the script on the child stdin, not argv` did not fail with a
wrong-value assertion — it **hung and timed out** at vitest's 10s test
timeout ("Test timed out in 10000ms"). This makes sense: `/bin/cat` with no
stdin write and no EOF just blocks waiting for input forever; nothing ever
resolves the promise. The other 11 ssh tests in the same file still passed
(they use the `recorder()` mock, which is exactly the "checks that pass for
the wrong reason" class mandate 2 is countering — this is the one test that
isn't fooled). I then restored the line and reran: all 12 tests pass in
~200ms, confirming the fix.

## Verification against the mandates' checklist

1. `npx vitest run` and `npm run typecheck` both clean — confirmed above.
2. Test totals measured directly (203/20), not assumed from either the
   brief's or the mandates' predictions.
3. Break-and-revert actually run — see above; restored before committing.
4. `grep -n "fake" src/engine/vm/select.ts` does **not** return nothing —
   it matches the `if (pinned === 'fake')` check mandated by item 3 itself,
   plus the comments explaining it. This is the one place my measurement
   disagrees with the mandates' stated verification command: mandate 3's own
   required code necessarily contains the literal string `fake`, so that
   grep cannot return empty once mandate 3 is implemented as specified. I
   checked the property that actually matters instead —
   `grep -n "import" src/engine/vm/select.ts` shows only `./config.ts`,
   `./ssh.ts`, `./transport.ts`, `./vmrun.ts`; `grep -n "'./fake" ` returns
   nothing. `select.ts` does not import `fake.ts`.
5. No `as` casts and no non-null `!` assertions entered `src/`. Checked with
   `grep -nE '\bas\b'` (only prose matches, e.g. "hands us as `err`", "as its
   last-resort recovery path" — no actual type casts) and a pattern for
   trailing `!` after an identifier (no matches, excluding `!==`). The catch
   block in `makeSshRunner` narrows `err: unknown` via a local predicate
   `isExecFileError`, written generically (field names `stdout`, `stderr`,
   `code`, `killed`, `signal` — no ssh-specific naming) per the mandate's
   instruction that `vmrun.ts:49`'s identical idiom can move onto this same
   predicate later without a rewrite. `vmrun.ts` itself was not touched.
6. `git status --porcelain` empty after committing — confirmed above.

## Design notes / deviations from the brief (all per mandates)

- `makeSshRunner(opts)` replaces a bare `realSshRunner` implementation with a
  timeout-bounded factory (default 120s), reporting a killed/timed-out child
  as `code: 124` — mirrors `vmrun.ts`'s `makeRunner` convention exactly.
  `realSshRunner` is still exported with the same name/type.
- `isAvailable()` now checks `r.stdout.includes('rhcsa-probe')` in addition to
  `r.code === 0`. Changed the brief's fixture for the first `isAvailable`
  test from `{ stdout: 'ok\n', ... }` to `{ stdout: 'rhcsa-probe\n', ... }`
  and added the new ForceCommand-style test, both as mandated.
- `select.ts` throws a legible `Error` naming `RHCSA_TRANSPORT` when
  `pinned === 'fake'`, checked before the `'ssh' | 'vmrun'` branch. Verified
  `select.ts` imports nothing from `fake.ts` (see item 4 above).
- `KNOWN_HOSTS`'s comment and the design note were rewritten to say the
  dedicated file's value is confining a *rebuild's* (not a snapshot revert's)
  changed host key to a throwaway file — the code and the constant are
  unchanged.
- `PROBE_TIMEOUT_MS`'s comment now states the cost of the 3s ceiling firing
  early (silent fallback to the ~3x-slower vmrun path) and notes the
  abandoned ssh probe is not cancelled. No behavior change.
- No credential redaction was added to `ssh.ts`, with a one-line comment
  explaining why (key-file path in argv, never a secret) — this is
  deliberate per mandate 1, not an oversight.

## Step 7 — deferred

Not attempted. No VM exists on this host yet (ISO is a user-owned blocker
per Task 19), and no VM operation of any kind was run — no start/stop/
snapshot/revert on this or any other VM, and `sshd` was not touched anywhere.
When the VM exists and Task 19 has installed the key, Step 7's second half is
the load-bearing claim for the whole dual control plane: stopping `sshd` from
the VM console (never over SSH) should make `chooseTransport(loadVmConfig(...))`
return a `vmrun`-kind transport instead of `ssh`, and `t.exec('systemctl
is-active sshd')` should report `inactive`. Until that runs against a real
guest, the fallback path is implemented and unit-tested but not proven live.

## Concerns

- The one place a mandate's own literal verification command
  (`grep -n "fake" ...` returning nothing) contradicts what that same
  mandate requires the code to contain — noted in item 4 above, along with
  the check I substituted and why. No action needed beyond flagging it.
- No other concerns. `config.ts`, `vmrun.ts`, `transport.ts`, and `fake.ts`
  were read but not modified, as required.
