# Task 23 — scoped re-review of fix rounds 1 and 2

Repo `/home/daxtangco/rhcsa-trainer`, branch `phase-0-1`, range **`ab32303..8083796`**
(2 commits: `b7c7f61`, `8083796`).

Task 23 built the HTTP API, the disclosure-ladder content layer, and the browser terminal
bridge — the first code here that opens a listening socket and the first that hands a browser a
shell on a guest where `student` has passwordless `sudo`. Its task review returned CHANGES
REQUIRED with 15 findings. These two commits are the response. Task 24 builds the UI on top.
**You are the gate before that happens.**

## Inputs

1. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/review-ab32303..8083796.diff` —
   70883 bytes, both commits, full context. **Read this, not `git diff`.**
2. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-review.md` — the original
   684-line review. Every finding is measured with its reproducing output quoted. This is the
   specification the fixes were written against.
3. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-fix-1.md` — my adjudication:
   what to fix, what to park, and four rulings. **Where I ruled PARK, an unfixed finding is
   correct behaviour, not a defect.**
4. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-report.md` — `## Fix round 1`
   at line 498, `## Fix round 2` at line 700. The implementer's account. **Do not inherit its
   numbers**; it is a claim to test, not evidence.

## This is a scoped re-review, not a fresh review

Your question is narrow: **did each finding actually get fixed, and did the fixes introduce
anything new?** You are not re-litigating the original review's findings or my rulings.

The one thing that expands your scope: these commits touch the two highest-risk surfaces on
the branch and add 800 lines. A fix that trades a HIGH for a different HIGH is the outcome
this pass exists to catch.

## Verdict required

**APPROVED** or **CHANGES REQUIRED**, plus a per-finding table: for each of F1-F17, one of
FIXED / NOT FIXED / PARKED-AS-RULED / REGRESSED. A report missing the table is not accepted.

## Priority order

### 1. The three HIGH fixes — prove each one, do not read it

- **F1** (`ws.on('error')`): the original crash was seven bytes with RSV1 set after a valid
  handshake, reaching the process as an uncaught `RangeError` and exiting it. Reproduce the
  frame against the fixed code and confirm the process survives **and** the pty is killed. A
  handler that swallows the error but leaks the pty is half a fix.
- **F2** (uncaught `spawnPty`): `sshArgs` throws whenever `cfg.ip` is empty, and the supported
  vmrun configuration is exactly that case. Drive it with an empty-`ip` config. Confirm the
  process survives, the client is told why in a way a student would see, and the socket closes.
  The implementer chose "attach and fail per-connection" over "do not offer the endpoint" —
  check that choice actually holds on the vmrun path rather than only on an ssh path with a
  blank IP.
- **F3** (`/finish` neither terminal nor idempotent): the original measured attack was, in
  **exam** mode, finish once to receive the full checkpoint key that `/grade` deliberately
  withholds via `revealed: false`, fix exactly those, finish again, collect `rating: 'easy'`
  and `allPassed: true`. **Replay that exact sequence end to end** through `app.request()` and
  confirm it is now refused. Then try to reach the same outcome another way: a second `/grade`
  before any `/finish`, a `/reset` after a `/finish`, an `/advance` or `/hint` after a
  `/finish`, and two `/finish` calls racing. 409 on the two named routes is not the same claim
  as "the key cannot be laundered".

### 2. F4 + F16 + F17 — the checkpoint counter, in both directions at once

This is the subtlest surface in the diff and the one where three separate fail-opens were
found. `CK_CALL` now reads

```
/(?:^[ \t]*|[;&|][ \t]*)ck(?:_pass|_fail|_skip)?[ \t]+["']?([A-Za-z0-9_][A-Za-z0-9_-]*)/g
```

and `session.ts` compares `statusById(v).size` against `expectedTotal`.

- Confirm the **unit** fix is real: build a verdict where one id arrives twice and a total of
  distinct ids short of `expectedTotal`, and confirm `incomplete` is now `true` where it was
  `false`. `GradeReport.passed` and `total` were also switched to distinct ids — check they
  agree with each other and cannot exceed `expectedTotal`.
- Confirm the **over**-count is closed: a `ck` inside a heredoc body must not count. Try
  `<<EOF`, `<<-EOF`, `<<'EOF'`, and a herestring `<<<`, which opens nothing.
- Confirm the **under**-counts are closed: `;`, `&&`, `||`, `|` prefixes, and an id containing
  `_` or an uppercase letter.
- **The comment discloses remaining misses** — a `ck` after `then`, `do`, `else`, `{`, `(` or a
  line continuation. So `if foo; then ck x "d" $?; fi` on one line is still missed. Measure
  whether that is reachable in the authoring style the five shipped graders actually use, and
  say whether the disclosure is adequate or the pattern should cover it. Under-counting is the
  fail-**open** direction, so this is not cosmetic.
- **Two invariants must be unchanged.** Re-measure them yourself:
  `countCheckpoints(content/lib/assert.sh) === 0`, and 019=8, 014=5, 017=5, 028=5, 006=8. The
  implementer reports all six unmoved across both rounds. If any moved, that is a regression
  and outranks everything else in this section.

### 3. F5/F6/F8 — the disclosure leak, tested against real content

The original leak: rung 4 of `content/tasks/selinux/019-httpd-alt-port` emitted `Listen` and
`DocumentRoot` — the two httpd directives the task is *about* — under a heading promising
arguments are omitted, then told the student to `man Listen`. The fix strips quoted runs before
splitting.

- Confirm the leak is gone **through the live `/hint` route at rung 4**, not only through a unit
  test on a synthetic string.
- Confirm every real command still survives: `sed`, `tee`, `awk`, `find`, `systemctl`, `dnf`,
  `semanage`, `restorecon`, `firewall-cmd`. A redactor that now hides commands has broken the
  hint instead of fixing it — **run the sketch for all five shipped tasks' first solutions and
  eyeball whether each is still a usable rung-4 hint.**
- `HEREDOC_START` was anchored (F8). Confirm `<<` inside a quoted run, after a `#`, and in a
  herestring no longer discards the rest of the solution.
- F6 was a test named for a property the code did not have. Confirm the new test would actually
  fail if the fix were reverted — **revert the quote-stripping in `/tmp` and watch it fail.** A
  test that passes both ways is the defect F6 named, reintroduced.
- **One disclosed regression to adjudicate:** stripping quoted runs means a quoted command
  substitution no longer contributes its inner words, so `troubleshooting/028` solution 01's
  `nmcli … "$(cat /etc/rhcsa-conn)"` now sketches as **`nmcli` alone**. Fail-closed, so safe,
  but a one-command rung-4 sketch is a weak hint. I parked it as a content concern. Say whether
  you agree, and whether any other shipped solution degraded the same way.

### 4. Ruling 3's extraction — `src/server/config.ts`

Two of the three controls on an unauthenticated, sudo-capable shell moved into a new file.

- Confirm the extraction is **faithful**: `readPort`'s validation shape must be unchanged,
  including the two acceptances deliberately preserved (`'0x50'` → 80, `' 22 '` → 22 — parked,
  do not report).
- Confirm the new module is genuinely **side-effect-free**: importing it must not run
  `loadVmConfig`, `loadBank`, `chooseTransport` or `serve`. Import it in isolation and prove it.
- Confirm the `HOST` test actually has teeth: it should assert `server.address()` is
  `127.0.0.1`/IPv4. **Delete `hostname` from the `serve` call in `/tmp` and confirm the test
  fails** — the original measurement was that omitting it yields `::`, i.e. every interface.
  This is the single most valuable assertion in the diff; if it passes without `hostname`, the
  extraction bought nothing.
- Confirm `allowedOriginsFor` still refuses everything the original review measured as refused:
  `''`, literal `null`, case variants, trailing slash, duplicate headers, `[::1]`, `https`.
- Confirm **no server is left listening** by any new test.

### 5. Everything else, briefly

F9 (`child.on('error')`), F10 (ping/heartbeat bounding idle and half-open terminals), F11
(`at()` docstring + `expectMissing` at the two masking sites), F12 (the misleading 400 message).
For F11, confirm `expectMissing` asserts the **parent container is a record** before asserting
absence — that is the whole point of it, and confirm the two masking assertions still fail when
the masking logic is deleted.

**PARKED — an unfixed finding here is correct. Do not report these as defects:** F7
(`/api/concepts/:id` stays ungated; only the false "rung 3 is gated" wording changed — I ruled
that gating the library would recreate the problem this app exists to solve), F13 (comment
only), F14/F15 (corrections to my documents), and the `'0x50'`/`' 22 '` parsing. Also parked and
out of scope: the seven pre-existing `.pathname` test files, the 5 src / 29 test casts, and
anything in `src/engine/grading/grader.ts`.

## Gates — run them, do not cite the report

- `npm run typecheck` → exit 0.
- `npx vitest run` → implementer claims **325 passed / 28 files** (task baseline was 301/27).
  Verify the count and that nothing is skipped.
- `node src/cli/index.ts coverage` → exit 0, zero `problem:` lines.
- **No new `as` casts** — the tree should still be src 5 / test 29 / scripts 0, all
  pre-existing. Build your own extractor; a *new* cast in this diff is a finding.
- Zero non-null `!` in `src/server/` and `src/engine/disclosure/`. No `enum`, no `namespace`,
  no parameter properties, no decorators.
- Nothing modified under `content/`, `src/cli/`, `objectives.yaml`, `content/lib/assert.sh`, or
  `src/engine/grading/grader.ts`. `package.json` should be untouched by these two commits.
- `git status --porcelain` empty before and after. **Do not mutate the repo** — mutation-test by
  copying the tree to `/tmp` with `node_modules` symlinked back, which is how the original
  review did it.

## Prohibitions

No VM operation of any kind, no `vmrun`. Do not run `scripts/provision.sh` (it powers on a VM
and copies 10 GB). Do not run `ssh-keygen` or write anything into `/home/daxtangco/.ssh/` — a
previous reviewer created a real keypair there. Do not create or read `.env.local` (git-ignored,
may hold the user's real VM password). Do not read `.env`, `.env.sandbox` or `.env.example`
under `/home/daxtangco/sechelp-tools` — an unrelated project. No `sudo` (no TTY here). No
subagents. **Do not leave a server listening.** `shellcheck` is not installed — six tasks have
confirmed it, so it is not a finding. `npm run validate` cannot run without a VM and its absence
is not a finding.

## Environment

The Bash tool runs **zsh**: unquoted `$var` does not word-split, `grep --include='*.ts'` needs
quoting, plain `grep -n "a\|b"` errors under ugrep (use `grep -nE`), a failed glob is an error
rather than an empty expansion, and `bash -s <<'EOF'` gets you bash semantics. `ls` is aliased
to **eza** — use `/bin/ls`. npm scripts run under `/bin/sh` → dash. Node **v22.23.2**, vitest
3.2.7, TypeScript 5.8. `124` means "timed out". `react`, `react-dom`,
`@testing-library/react`, `jsdom`, `tailwindcss`, `@xterm/xterm` are **not installed** — Task 24
owns them, so anything about the browser is reasoned, not measured.

## The bar

The defect class this project keeps producing is **a tool reporting success when it did not do
what was asked.** In this diff the same class is available in new places: a handler that
swallows an error but leaks the pty, a 409 that guards two routes while the key stays reachable
by a third, a counter that closes two directions and opens a fourth, a redactor that stops
leaking by starting to hide, and a test that passes whether or not the fix is present.

For every item ask whether it can report a pass where the state is wrong, or a fail where the
state is right. **Label each conclusion `measured` or `reasoned`** — a "verified" label on
reasoning is the failure that produced this whole sequence. The implementer verified several
fixes by breaking the code and watching a test fail; that is the standard, and where it claims
to have done so, **redo it rather than believing it**.

## Report

Write the full re-review to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-rereview.md`.

Return only: the verdict, the per-finding table, every new finding with a severity and a
one-line failure scenario, and your adjudication of the `028` sketch degradation. If one of my
rulings is wrong, say so directly — five of my claims have been wrong across the last four
tasks and every one was caught by a reviewer rather than by me.
