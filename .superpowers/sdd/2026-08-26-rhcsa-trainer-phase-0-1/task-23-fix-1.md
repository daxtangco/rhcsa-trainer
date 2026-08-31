# Task 23 — fix round 1

Your review came back **CHANGES REQUIRED**: 3 HIGH, 6 MEDIUM, 5 LOW, 2 INFO. The full
report is at `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-review.md` —
**read it, it is the specification for this round.** Every finding there is measured, with
the reproducing output quoted. I have adjudicated all fifteen below. Where I say PARK you
do nothing; where I say FIX, the report's own "Fix:" text is authoritative and I have added
only what it left open.

The review is good and it found a real bug in **my** mandate 7 (F4). It also corrected two
of my claims (F14, F15) and one premise (mandate 9). Do not defend the original code
against it.

Head is `ab32303`. Work on `phase-0-1`. Same commit discipline as before: stage by name,
never `git add -A`, explicit identity inline.

---

## FIX — the three HIGH findings

### F1 — `ws.on('error')` is missing, so one malformed frame exits the process

`terminal.ts:142-152`. Add an `error` listener on the socket, log it, and kill the pty.
The `bridge` comment at `terminal.ts:49` already states the intended policy — "a malformed
frame is not worth ending a lab session over" — so make the code match its own comment.

Add a test: a real handshake, then write a frame with RSV1 set, and assert the process
survives and the pty is killed. The review reproduced this with seven raw bytes; reuse its
method.

### F2 — a `spawnPty` throw in the upgrade callback is uncaught, and the vmrun path guarantees it

`terminal.ts:143`. Wrap the `spawnPty` call in `try`/`catch`. On a throw: send the error
text to the client as a terminal-visible line **before** closing, then close with a status
code. The student must see why the tab is empty; `RHCSA_VM_IP` going to a stderr they are
not watching is exactly the failure the review describes.

This one is not hypothetical — `chooseTransport` falling back to `vmrun` is a supported
setup, `sshArgs` throws whenever `cfg.ip` is empty, and `index.ts:80` calls `attachTerminal`
unconditionally. So also decide and implement what the terminal does when the live transport
is `vmrun`: either attach and fail per-connection with a clear message, or do not offer the
endpoint. **Attach and fail clearly** — Task 24 renders a tab either way, and a tab that
explains itself beats a tab that 404s. Say which you did in the report.

Test it with a config whose `ip` is empty.

### F3 — `/finish` is neither terminal nor idempotent, so exam rating can be laundered

`app.ts:235` and `app.ts:259`. Implement the report's fix: `/finish` returns **409** when
`phase === 'graded'`, and `/grade` returns **409** on a finished session. The measured
attack is finish-early-to-read-the-key, fix exactly those checkpoints, finish again, collect
`rating: 'easy'` — in exam mode. That is the app lying about a cold solve, which is worse
than any crash here.

Use 409 to match `/hint`'s existing over-cap convention, and reuse its message shape.

Tests: the full measured sequence — grade, finish, then assert the second `/grade` and the
second `/finish` are both 409, and that `endedAt` and the stored rating did not move.

---

## FIX — the MEDIUM findings

### F4 — mandate 7's guard compares a line count to a distinct-id count

**This is my defect, not yours.** `session.ts:100` is
`v.checkpoints.length < expectedTotal`, comparing lines to distinct ids, so a grader that
emits one id twice and is then killed reports `allPassed: true` for a checkpoint that never
ran — re-opening the exact false pass mandate 7 was written to close.

Fix as the report says: `statusById(v).size < expectedTotal`. `duplicateIds` and
`statusById` are already exported from `verdict.ts`.

`passed` and `total` in `GradeReport` carry the same wrong unit. Fix them too, and say in
the report what `total` now means so Task 24 renders "3 of 5" from the right numbers.

Also close the over-count direction the review found: `CK_CALL` matches inside a heredoc
body, so `cat <<'EOF' … ck heredoc-id … EOF` counts a checkpoint that never executes,
producing a **false `incomplete`** — a false fail on a correct solution. Skip heredoc bodies
in `countCheckpoints`. Pin both directions with tests.

### F5 + F6 + ruling 4 — `commandSketch` leaks argument text, and the test that should catch it passes for an unrelated reason

The doc comment at `content.ts:90` says "neither can leak an argument". The repo contains a
first-solution fixture that leaks two: rung 4 of `selinux/019-httpd-alt-port` emits `Listen`
and `DocumentRoot`, the two httpd directives the task is about, under a heading promising
arguments are omitted — then tells the student to `man Listen`.

Do all four things ruling 4 requires:

1. **Strip quoted runs before splitting.** Replace the contents of `'…'` and `"…"` with a
   placeholder that cannot match `COMMAND_SHAPE`, then split on the separators as now. The
   review measured that this removes `Listen`, `DocumentRoot`, `sdb1`/`sdb2` and the
   `grep -E 'foo|bar'` class while leaving `sed`, `tee`, `awk`, `find` and `systemctl`
   intact.
2. **Anchor `HEREDOC_START`** (F8) so `<<` inside a quoted run, after a `#`, or in a
   herestring does not silently discard the rest of the solution. Add the herestring case to
   the tests. Also handle, or document as residuals, the three siblings the review measured:
   a first word that is a variable expansion (`$EDITOR /etc/fstab` → `[]`), a leading
   redirect (`> /etc/motd echo hi` → `[]`), and a `case` block emitting one word per label.
3. **Fix the two false claims** — `content.ts:90`'s sentence, and the name of
   `content.test.ts:98`, which claims to test sed-with-`|` but passes only because every
   fragment contains `[` or `'`.
4. **Test against real bank content**: assert the rung-4 sketch for `selinux/019`'s
   solution 01 contains neither `Listen` nor `DocumentRoot`. This is the assertion whose
   absence let the leak look fixed. Read the bank read-only; **do not edit anything under
   `content/`.**

Leave the unquoted-delimiter residual (`sed -i s\|a\|b\| /etc/hosts` → `hosts`) unfixed and
**documented** as a residual, per the ruling.

### F7 — rung 3 is reachable in exam mode through `/api/concepts/:id`

**Ruling: the open card browser stays. The false claim goes.**

`GET /api/concepts/:id` returns a full card with no session, mode or rung check, one hop
from `/api/tasks/:area/:slug`'s concept ids. The review is right that this contradicts
calling rung 3 gated — but gating the library would break the thing this app exists to be.
The user's stated purpose is that this app *replaces the book*; a concept library you may
only reach by failing a hint ladder is a worse book. So:

- Keep `/api/concepts/:id` ungated.
- **Correct the wording** wherever rung 3's *content* is described as gated. The honest
  statement is that the ladder governs what the hint endpoint hands you on request, not what
  the library contains. Fix it in `content.ts`, `ladder.ts` and the brief's `Produces` text
  if it appears there.
- Add one line to your report for Task 24: **exam mode must not surface concept-card links
  in the session view.** Exam realism is a UI affordance question, not an API gate — that is
  the right layer for it, and it is Task 24's to build.

Cost if I am wrong: a student self-sabotages one exam-mode rehearsal by opening a card in
another tab, and learns something. Cost of the alternative: the library is locked behind
failure, which is the book problem again.

---

## FIX — the LOW findings, and ruling 3's extraction

- **F9** — add `child.on('error')` in `spawnSshPipe`. Same blast radius as F1/F2, trivial.
- **F10** — bound idle and half-open terminals. Construct the `WebSocketServer` with a
  ping/heartbeat and terminate a socket that misses a pong. A leaked `ssh -tt` plus guest
  PTY surviving laptop sleep is a real cost on a single-laptop tool.
- **F11 + ruling 1** — the `at()` docstring is wrong: a missing key at **any** depth returns
  `undefined`, not only at the leaf. Correct it to "a missing key at any depth returns
  `undefined`; a type mismatch throws". Add
  `function expectMissing(root: unknown, ...path: Array<string | number>): void` that
  asserts the parent container is a record before asserting the key is absent, and use it at
  the two `toBeUndefined()` sites (`app.test.ts:215` and `:375`). **Do not retrofit the
  other 25 `at` assertions** — the review proved both masking assertions have teeth by
  deleting the masking logic and watching them fail.
- **F12** — `/api/sessions` answers a malformed body with `unknown task: undefined`. Make the
  message name the actual problem. Status stays 400.
- **Ruling 3 — extract a side-effect-free `src/server/config.ts`** exporting `readPort`,
  `HOST`, `VITE_DEV_PORT` and `allowedOriginsFor(port, vitePort)`, with `index.ts` reduced to
  wiring. The reason is not the line count: `HOST` is one character from binding `::`,
  measured, and no test would fail. The obstacle was never purity — `readPort` is already
  pure — it is that importing `index.ts` executes `loadVmConfig`, `loadBank`,
  `chooseTransport` and `serve`.

  Pin all five checks the ruling lists, including the one that matters most and is already
  known to work: `serve({ fetch, port: 0, hostname: HOST })`, assert `server.address()` is
  `{ address: '127.0.0.1', family: 'IPv4' }`, assert `server instanceof Server`, close it.
  That is the regression test for mandate 2(a) itself. **Close every server you open** — a
  listening socket must not outlive the test.

---

## PARK — do not fix these

- **F13** (shared `upgrade` listener destroys sockets for other paths) — it is the only
  upgrade consumer today. Add a comment naming the constraint so the next endpoint's author
  is not debugging a mystery, and nothing more.
- **F14, F15** — corrections to my own documents, no code change. I have recorded both.
- The `'0x50'`→80 and `' 22 '`→22 acceptances shared by `readPort` and `loadVmConfig`:
  cosmetic, parked for the whole-branch review. Do not change the parsing shape while
  extracting it — a faithful move is what makes the extraction reviewable.

## One correction to carry into your report

Your Step 20 prediction of `"rebooted": true` is contingent, not certain: `grade()` returns
early with `rebooted: false` when `!task.rebootCheck || !anythingPassed`
(`grader.ts:88-92`), so on an untouched guest the correct expected value is **`false`**.
Write that into the manual step so a `false` is not later read as a regression.

---

## Gates — all must pass before you report

- `npm run typecheck` → exit 0.
- `npx vitest run` → all green. Baseline is **301 passed / 27 files**; you are adding tests,
  so the count goes up and must not go down.
- `node src/cli/index.ts coverage` → exit 0, zero `problem:` lines.
- **No new `as` casts** (src stays at 5, test at 29, scripts 0), no non-null `!`, no `enum`,
  no `namespace`, no parameter properties, no decorators.
- `git status --porcelain` empty when you finish, with your work committed.
- Nothing under `content/`, `src/cli/`, `objectives.yaml` or `content/lib/assert.sh` is
  modified. `src/engine/grading/grader.ts` is out of scope — F4 is fixed in
  `src/server/session.ts`, not in the grader.

## Prohibitions

No VM operation, no `vmrun`, no `scripts/provision.sh`. Do not run `ssh-keygen` or write
into `/home/daxtangco/.ssh/`. Do not create or read `.env.local`. No `sudo` (no TTY). No
subagents. Do not leave a server listening. `shellcheck` is not installed — not a finding.
The Bash tool runs **zsh**: use `bash -s <<'EOF'` for bash semantics, `/bin/ls` not `ls`,
`grep -nE` not `grep -n "a\|b"`, and remember a failed glob is an error, not an empty
expansion.

## Report

Append to `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-report.md` under a
`## Fix round 1` heading. Return only: per-finding disposition (fixed / parked-as-told /
disagreed-and-why), the gate results, the new test count, and anything you could not do.

If you think one of my rulings above is wrong, say so in the report and implement it anyway
unless it is a correctness problem — in which case stop and tell me.

---

## Addendum to F4 — also close the under-count, not just the heredoc over-count

This was sent as a message during the first (lost) dispatch and is recorded here so it cannot
go missing again.

`CK_CALL` at `src/server/session.ts:34` allows only `[ \t]*` before `ck`, so a `ck` that
follows a command separator on the same line yields **no id**. `MEASURED`:

| script | ids counted |
|---|---|
| `ck alpha "d" $?` (column 0) | 1 |
| `    ck beta "d" $?` (indented) | 1 |
| `test -f /etc/fstab; ck gamma "d" $?` | **0** |
| `true && ck delta "d" $?` | **0** |
| `grep -q x /f \| ck epsilon "d" $?` | **0** |
| `ck one "d" $?` + `false; ck two "d" $?` | **1** of 2 |

The third row is the problem: `content/lib/assert.sh:60` documents
`some_condition; ck my-id "what was checked" $? "what to look at"` as **the** usage. An author
following the library's own documentation writes checkpoints the counter cannot see.

**This defeats F4's fix rather than merely coexisting with it.** A grader with five real
checkpoints, two written the documented way, declares 3. `expectedTotal` is 3, so a run
truncated after 3 of 5 gives `incomplete === false` and mandate 7's guard is disabled — the
same false pass through the other door. Fixing the unit comparison alone would leave the hole
open while making it look closed.

Latent, not live, stated precisely so you do not over-fix: the only `[;&|][[:space:]]*ck`
match anywhere under `content/` is that documentation line itself, all five graders put every
`ck` at column 0 or indented, and the counts 019=8, 014=5, 017=5, 028=5, 006=8 are correct
today.

Extend the pattern to accept a `ck` following `;`, `&&`, `||` or `|` on the same line. Keep
every currently-correct behaviour: a `ck` in a comment and the word `ck` inside a string must
still count zero — the reviewer measured both and they are genuinely right. Keep the heredoc
skip from F4 above. Pin all of it: the four separator forms, the comment form, the in-string
form, the heredoc form, and one script combining a column-0 call with a documented-inline call.

**Do not edit `content/lib/assert.sh`** — out of scope, and its documentation is correct. The
regex is what is wrong.

Two invariants must not move: `countCheckpoints` over `content/lib/assert.sh` must stay **0**
(mandate 6's pinning test), and the five grader counts above must stay exactly as they are. If
either moves your pattern is too greedy — **report it rather than adjusting the expected
numbers.**
