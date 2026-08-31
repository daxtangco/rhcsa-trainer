# Task 23 — re-review of fix rounds 1 and 2 (`ab32303..8083796`)

Reviewer: subagent `task-23-rereview`. Scope: the two fix commits `b7c7f61` and `8083796`
against `.../task-23-review.md` (F1–F17) and `.../task-23-fix-1.md` (the rulings).

**Verdict: CHANGES REQUIRED.**

Every one of the 17 findings is properly dispositioned — nothing was left unfixed that the
rulings said to fix, and nothing that was parked was touched. The three HIGH fixes are real and
I proved each one by execution against an `ab32303` control. What earns CHANGES REQUIRED is the
one surface the context document predicted: **the checkpoint counter closed two directions and
opened two new ones**, both regressions against the base commit, one of them the *same* defect
class this very commit fixed one file over. Neither is reachable in the shipped bank today and
both pinned invariants hold, so the change is small; I have measured a fix that closes both with
325/325 green and all six invariants unmoved.

Method: every claim below is labelled `measured` or `reasoned`. Mutation testing was done in
`/tmp/t23rr` (a copy of the tree with `node_modules` symlinked back) and base-commit controls in
`/tmp/cast-ab32303` (`git archive` of `ab32303`, same symlink). `git status --porcelain` in the
real repo was empty before and after; nothing under `content/`, `src/cli/`, `objectives.yaml`,
`package.json` or `grader.ts` was touched by me or by the diff. No VM, no `vmrun`, no `ssh`
connection, no `ssh-keygen`, no `.env*`, no server left listening.

---

## Gates (measured, re-run rather than cited)

| Gate | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npx vitest run` | **325 passed / 28 files**, 0 failed, 0 skipped, 0 todo, exit 0 |
| `node src/cli/index.ts coverage` | exit 0, `problem:` lines = 0 |
| New `as` casts / non-null `!` | zero added. My own TypeScript-compiler-API extractor reports an identical cast census on `ab32303` and `8083796` (src 15 / test 29 / scripts 0 by my counting method — the absolute src number differs from the review's 5 because I count nested double casts separately; the *delta* is what the gate asks for and it is 0). No `!`, no `enum`, no `namespace`, no decorators, no parameter properties in `src/server/` or `src/engine/disclosure/` |
| Files touched | `src/server/{app,session,terminal,index,config}.ts`, `src/engine/disclosure/content.ts`, `test/server/{app,session,terminal,config}.test.ts`, `test/disclosure/content.test.ts`. Nothing under `content/`, `src/cli/`, `objectives.yaml`, `package.json`, `package-lock.json`, `grader.ts` |
| `git status --porcelain` | empty before and after |

---

## Disposition table

| # | Finding | Disposition | Evidence |
|---|---|---|---|
| F1 | `ws.on('error')` missing → one malformed frame exits the process | **FIXED** | measured: 7-byte RSV1 frame after a valid handshake; process survives, socket ends, **pty killed**. Test has teeth (replacing the handler with `ws.on('error', () => {})` fails `survives a malformed frame, killing the shell and not the process`). Base control crashes |
| F2 | uncaught `spawnPty` throw; the vmrun path guarantees it | **FIXED** | measured on the *vmrun* config (`cfg.ip = undefined`, `forceTransport: 'vmrun'`): client receives `[terminal] cannot start: SshTransport has no IP…`, close code 1011, process and endpoint survive; next connection still works. Test has teeth |
| F3 | `/finish` neither terminal nor idempotent → laundered exam rating | **FIXED** | measured, full replay in exam mode: grade 200 (no key) → grade 200 (no key) → **finish 200 (key, `rating: 'hard'`)** → finish **409** → grade **409** → hint 200 (no key) → hint 409 (cap) → finish 409; `GET /api/sessions/:id` exposes 9 fields and no key; three racing finishes → `200 409 409`, **exactly one key reveal**. Both 409s have teeth. Two hygiene residuals, see N4/N6 |
| F4 | mandate 7's guard compares a line count to a distinct-id count | **FIXED** | measured: one id arriving twice with 2 distinct of 3 expected now yields `incomplete: true` (base: `false`, false pass). `passed`/`total`/`checkpoints[]` all switched to distinct ids and agree with each other. Reverting either half fails a test |
| F5 | `commandSketch` leaks argument text on shipped content | **FIXED** | measured through the **live `/hint` route at rung 4**: `selinux/019` renders `dnf sed tee semanage restorecon firewall-cmd systemctl`; base rendered `dnf sed **Listen DocumentRoot** tee …`. No capitalised word, no `man Listen` |
| F6 | the test that should catch F5 passed for an unrelated reason | **FIXED** | measured: reverting the quote-stripping in `/tmp` fails **4** tests, including the real-bank one (`does not hand rung 4 the two httpd directives selinux/019 is about`). The new test genuinely depends on the fix |
| F7 | rung 3 reachable in exam mode via `/api/concepts/:id` | **PARKED-AS-RULED** | still ungated by design; only the false "rung 3 is gated" wording changed. Not reported as a defect |
| F8 | `HEREDOC_START` unanchored in `content.ts` | **FIXED** | measured: `<<` inside a quoted run, after a `#`, and in a `<<<` herestring no longer discard the rest of the solution; a *real* `<<EOF`, `<<-EOF`, `<<'EOF'` body is still skipped and its contents never leak. Anchoring has teeth. **But see N1: the same defect is still live in `session.ts`** |
| F9 | `spawnSshPipe` registers no `child.on('error')` | **FIXED** | measured with `PATH` pointed at a nonexistent directory (spawn fails before any network): `[terminal] ssh could not start: spawn ssh ENOENT`, `onExit(1)`, process alive; a keystroke afterwards does not throw (`stdin` EPIPE swallowed). Base control dies with an uncaught `ENOENT` |
| F10 | nothing bounds an idle or half-open terminal | **FIXED, unpinned** | measured: a half-open socket is `terminate()`d at the second beat and the pty is killed; a healthy socket survives ~8 beats untouched. **No test pins any of it** — see N3 |
| F11 | `at()`'s docstring overstates its guarantee | **FIXED** | measured: `expectMissing` asserts `isRecord(parent)` before asserting absence and is non-vacuous (mistyping the parent path to `'reprot'` fails with `expected a record at reprot, got undefined`). Used at both masking sites (`checkpoints` on an exam grade, `rating` on the refused second finish). Deleting the masking gate fails 3 tests |
| F12 | `/api/sessions` reports a body problem as a task problem | **FIXED** | measured: non-object body → 400 `body must be a JSON object with taskId and mode`; non-string `taskId` → 400 `taskId must be a string`. Reverting to the old shape fails `blames the body, not the task…` |
| F13 | shared `upgrade` listener destroys sockets for other paths | **PARKED-AS-RULED** | comment only; the comment is present and accurate |
| F14 | mandate 8's per-file count | **PARKED-AS-RULED** | correction to the lead's document |
| F15 | the report understates its own coverage | **PARKED-AS-RULED** | correction to the lead's document |
| F16 | `countCheckpoints` cannot see a `ck` after a separator | **FIXED** | measured: `;`, `&&`, `||`, `|` prefixes all counted (base: 0 for each). Heredoc bodies excluded, `<<<` opens nothing. Reverting the separator alternation fails 2 tests |
| F17 | the id character class silently truncates or drops ids | **FIXED** | measured: `ck lv_size` next to `ck lv` now counts 2 (base 1); uppercase and `_` accepted. Narrowing the class back to `[a-z0-9-]` fails `does not collide two ids that share a prefix…`. All six pinned counts unmoved |

**No finding is NOT FIXED and none of F1–F17 is REGRESSED.** The regressions below are new
behaviour introduced alongside the F4/F16/F17 rewrite, not a re-opening of a listed finding.

### The two pinned invariants (measured, both directions)

Re-measured myself, standalone and through the production path (`assertLib + grade.sh`, which is
what `loadTaskScripts` hands `countCheckpoints`):

```
assert.sh alone                           0  (want 0)
selinux/019-httpd-alt-port                8  (want 8)
storage/014-grow-home-lv                  5  (want 5)
systemd/017-boot-time-service             5  (want 5)
troubleshooting/028-restore-remote-access 5  (want 5)
users/006-team-provisioning               8  (want 8)
```

Nothing moved, in either commit, on either path.

---

## New findings

### N1 — MEDIUM (measured, regression against `ab32303`) — `session.ts`'s `HEREDOC_START` is unanchored and quote-blind: the exact defect F8 fixed in the sibling file

`src/server/session.ts:61` is `/<<-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/` — unanchored, and
applied to a line whose quoted runs are still intact. `content.ts:65` is the *anchored* version,
because F8 measured what the unanchored one does. A `<<` that is not a heredoc opener therefore
opens a phantom heredoc in the counter and every remaining line of the grader is discarded.

Measured with `ck` at column 0 in every case, so only the heredoc handling can move the number:

| script | `8083796` | `ab32303` |
|---|---|---|
| `want=$(( 1 << shift ))` then `ck real-id …` | **0** | 1 |
| `echo "a << b"` then `ck real-id …` | **0** | 1 |

**Failure scenario:** a grader containing `echo "a << b"` or `want=$(( bytes << shift ))`
declares fewer checkpoints than it has, a truncated grader run then matches the deflated
`expectedTotal`, `incomplete` stays `false`, and a student who changed nothing is told the task
passed. This is the fail-**open** direction and `expectedTotal` is the only thing mandate 7's
guard has.

Not reachable in the bank today (measured): the only `<<` in any grader is
`content/tasks/troubleshooting/028-restore-remote-access/grade.sh:33`'s `<<<"$perm"`, which the
`<<<` → space replacement handles, and the only `$((` uses are `want_epoch / 86400` and
`1024 ** 2..4` — no shifts. Task 25's lint will not see this either: the script is valid bash.

### N2 — MEDIUM (measured, regression against `ab32303`) — the widened `CK_CALL` counts a phantom id inside a quoted string, and the docstring claims it cannot

`session.ts:38-39` states the counter is "in practice, [blind] to the word `ck` inside a string,
since no separator precedes it there." Adding the separator alternation falsified exactly that
sentence: a separator *inside* the string is enough.

| script | `8083796` | `ab32303` |
|---|---|---|
| `printf "ok; ck phantom-id\n"` then `ck real-id …` | **2** | 1 |
| `echo "done; ck it later"` then `ck real-id …` | **2** | 1 |

**Failure scenario:** a grader that prints a progress line containing `; ck ` declares one more
checkpoint than it has, so a complete run over a correctly solved machine is reported
`incomplete` and `allPassed` is forced to `false` — a false **fail** on a correct solution, the
one direction the F4 comment calls out as the thing to avoid. The shipped tests only pin
separator-free strings (`# ck nope`, `ck real … # ck nope`), which is why this passed.

### N1 + N2 have a fix I measured green

Reuse the single pass `commandSketch` already uses, with one addition — a quote that directly
follows a `ck` token is quoting the **id** (`ck_pass 'home-from-lv' "…"`, which
`GRADE_BRANCHED` contains) and must be kept. Concretely, in `countCheckpoints`, replace

```ts
const code = withoutComment(raw).replace(/<<</g, ' ')
const started = HEREDOC_START.exec(code)
if (started?.[2] !== undefined) heredoc = started[2]
```

with a scan that walks the line once: at `<<<` emit a space and skip 3; at `<<` read the
delimiter with the **anchored** regex against the remaining slice *before* any quote handling
(so `<<'EOF'` still opens a heredoc), emit a space and skip 2; at a quote, empty the run unless
`/ck(?:_pass|_fail|_skip)?[ \t]+$/` matches what has been emitted so far.

Measured in `/tmp/t23rr`: **325/325 tests pass**, all six invariants unmoved
(`assert.sh` 0; 019=8, 014=5, 017=5, 028=5, 006=8), `echo "a << b"` → 1,
`printf "ok; ck phantom-id\n"` → 1, real heredoc bodies still excluded, separator and `&&` forms
still counted, prefix collision still 2, `<<<"$perm"` still 1. Two naive variants I tried first
do **not** work and are worth knowing about: emptying quoted runs without the `ck` exception
breaks `GRADE_BRANCHED`'s quoted id, and emptying them before reading the delimiter breaks
`<<'EOF'`.

Residual after that fix (measured): `$(( 1 << shift ))` still under-counts, because the `<<` is
not inside quotes. Closing it needs the opener to be recognised only in a redirect position;
disclosing it in the comment is a defensible alternative, but it must then be disclosed
accurately — see N5.

### N3 — MEDIUM (measured) — F10's heartbeat is pinned by nothing

Deleting the **entire** heartbeat block (interval, `pong` handler, `terminate`, `clearInterval`)
leaves `test/server/terminal.test.ts` at **12 passed (12)**. Deleting only the `ws.terminate()`
branch also leaves 12/12.

**Failure scenario:** a later edit drops or breaks the interval, a closed laptop leaves
`ssh -tt` and a guest PTY alive indefinitely on the machine running the trainer, and CI is green.
The seam already exists in the file's own style: `TerminalDeps.spawnPty` is documented as an
"injection point for the tests". Add `heartbeatMs?: number` beside it and pin the two behaviours
I measured by hand (no pong for two beats → `terminate` + pty killed; a responsive socket
survives).

### N4 — MEDIUM (measured) — the property F3 exists to protect is unpinned on the routes F3 did not gate

Adding one field to `view()` (`result: s.result`, `app.ts:312-324`) publishes the full unmasked
checkpoint list — ids, descriptions, statuses — through `GET /api/sessions/:id` **and** `/reset`,
in exam mode, before any finish. The whole app suite stays at **18 passed (18)**.

**Failure scenario:** Task 24 needs one more field on the Lab screen, the obvious edit adds
`result` to `view()`, and the exam answer key ships to the browser with a green build. The
current code does not leak (measured: no route other than `/finish` emits a checkpoint id in exam
mode), but nothing holds it there. Pin it: assert that the serialised body of every non-grade
session route in exam mode contains neither checkpoint id.

### N5 — LOW (measured) — the counter's "known misses" list is wrong in one direction and silent in another

`session.ts:53-55` lists "a `ck` after `then`, `do`, `else`, `{`, `(` or a line continuation".
Measured: `then`, `do`, `else`, `{`, `(` are genuine misses (0 each, base 0). A **line
continuation is not a miss** when the continued line starts with a separator or a bare `ck` —
`test -f /x \` + `  && ck cont-id "d" $?` counts **1** (base 0), and `true \` + `  ck cont2-id`
counts 1. Meanwhile `$(( x << n ))` (N1) *is* a miss and is not listed.

Separately: `total` may exceed `expectedTotal` and nothing notices — 5 distinct ids arriving
against a declared 3 yields `incomplete: false, allPassed: true` (measured). That over-arrival is
the observable signature of an under-count, i.e. of exactly N1; a log line or a flag there would
have surfaced N1 at runtime.

**Failure scenario:** a future grader author trusts the list, writes the shape it says is safe,
and the counter disagrees — silently, in the fail-open direction.

On the reachability question the context asked me to settle: **the disclosure is adequate for the
`then`/`do`/`else`/`{`/`(` group and the pattern does not need to cover it yet** (measured — 43
`ck` call sites across the five graders, every one at column 0 or indented; `grep -rnE
'(then|do|else|\{|\()[ \t]+ck(_pass|_fail|_skip)?[ \t]'` over `content/` and `docs/` returns
nothing; `content/lib/assert.sh` documents only `# ck ID DESC EXIT_STATUS [DETAIL]` and the
separator form `some_condition; ck my-id "…" $?`, and the separator form is now counted, which
was F16's whole point). The disclosure is **not** adequate as written, because two of its
specifics are wrong.

### N6 — LOW (measured) — `/reset` and `/hint` are not phase-aware, so a finished session can be made internally inconsistent

Measured on a finished exam session: `POST /reset` → **200**, `startedAt` moves to 4000 while
`endedAt` stays 3000 (`phase` still `graded`); `POST /hint` → **200**, the rung advances. Neither
leaks a key and neither can produce a second rating, so F3's security claim holds.

**Failure scenario:** anything that computes "time spent" from `endedAt - startedAt` on a
finished-then-reset session gets a negative number, and a finished session's `rung` no longer
matches the rung the already-issued rating was derived from — the report describes an attempt
that did not happen, which is the wording F3 itself uses. Cheapest fix consistent with the two
409s already there: refuse both routes on `phase === 'graded'` with the same message shape.

### N7 — INFO (measured) — nothing pins that production actually passes `hostname: HOST`

The new `HOST` test has real teeth for what it covers: dropping `hostname` from *its own* `serve`
call fails it with `expected '::' to be '127.0.0.1'` — the exact original measurement. But
`index.ts:38` is the line that matters, and `index.ts` cannot be imported by a test (four side
effects), so deleting `hostname: HOST` from it breaks nothing. Exporting a
`serveOptions(fetch, port)` from `config.ts` and asserting on that would close the last link.
`readPort` is byte-identical to the base version, `HOST` and the four origins are unchanged, and
`allowedOriginsFor` refused all 18 near misses I threw at it (`''`, `'null'`,
`HTTP://localhost:5175`, `http://LOCALHOST:5175`, trailing slash, `[::1]`, `https`, `ws`,
trailing space, comma-joined duplicate header, `evil.localhost`, `localhost.evil.com`,
`0.0.0.0`, `127.1`, `127.0.0.001`, wrong port, no port, path suffix). Importing `config.ts` in
isolation loads **exactly one module** (itself — measured with a `node:module` load hook) and
leaves **zero active handles**; no test leaves a listener (measured: the suite exits, and nothing
is listening on 5173/5175 afterwards).

### N8 — INFO (measured) — the `<<<` branch in `scanLine` is redundant, so the herestring assertion has no teeth of its own

Deleting the `startsWith('<<<')` branch leaves `test/disclosure/content.test.ts` at 19/19,
because the anchored `HEREDOC_START` already refuses `<<<` (the character after `<<` is `<`, not
`['"]?[A-Za-z_]`). Worth keeping as defence in depth; worth knowing it is not what the test
proves.

### N9 — INFO (measured) — the one bank output this diff changed besides 019 is not pinned

`commandSketch over the real bank` pins 014 exactly and 017 exactly, and 019 by properties. It
does not pin `troubleshooting/028`, which is the solution whose sketch this diff changed. One
line — `expect(commandSketch(await solution('tasks/troubleshooting/028-.../solutions/01-....sh')))
.toEqual(['systemctl', 'firewall-cmd', 'nmcli'])` — makes the next change to the splitter notice.

---

## Adjudication: the `troubleshooting/028` sketch degradation

**I agree with parking it as a content concern, and the ruling understates how good the outcome
is.** Two corrections to the framing, both measured.

1. **028's rung-4 sketch is three commands, not one.** The lead's note reads "`nmcli … "$(cat
   /etc/rhcsa-conn)"` now sketches as `nmcli` alone… a one-command rung-4 sketch is a weak hint."
   That is true of the *line*; the *task's* sketch is `systemctl firewall-cmd nmcli` (measured
   through the live `/hint` route). What was lost is `cat` — the fourth entry, and the only one
   that is not part of the task. 028 is about restoring remote access: `systemctl`,
   `firewall-cmd` and `nmcli` are the whole answer, and "read the man page for `cat`" was never
   the hint that saved anyone.

2. **Exactly two sketches in the whole bank changed, and no command was lost anywhere else.**
   Base vs fixed, all five first solutions:

   ```
   019  dnf sed Listen DocumentRoot tee semanage restorecon firewall-cmd systemctl
    →   dnf sed               tee semanage restorecon firewall-cmd systemctl
   014  lvextend xfs_growfs                → unchanged
   017  tee systemctl                      → unchanged
   028  systemctl firewall-cmd nmcli cat   → systemctl firewall-cmd nmcli
   006  groupadd useradd usermod chage printf tee chmod visudo  → unchanged
   ```

   Every command the context asked me to check for survives: `sed`, `tee`, `awk`(n/a — not in any
   first solution), `find`(n/a), `systemctl`, `dnf`, `semanage`, `restorecon`, `firewall-cmd`,
   plus `lvextend`, `xfs_growfs`, `groupadd`, `useradd`, `usermod`, `chage`, `printf`, `chmod`,
   `visudo`, `nmcli`. The redactor did not start hiding commands: it removed two config
   directives and one incidental `cat`.

   The one shape where the new stripping *could* hide a real command is a wrapped one —
   `sudo sh -c "systemctl restart httpd"` sketches as `bash`/`sh` alone. Measured: no solution,
   antisolution or setup script in the bank uses `sh -c` or `bash -c`, so it is not reachable
   today. It belongs in the docstring's residual list, which does not mention it.

So: fail-closed, three useful commands, one incidental loss, no other degradation. Content
concern, no code change needed. Add N9's one-line pin so the next splitter change has to notice.

---

## What CHANGES REQUIRED means here, concretely

1. **N1** — anchor/scan the heredoc opener in `countCheckpoints` (fix measured green above).
   This is the fail-open one.
2. **N2** — same edit closes it; alternatively correct the docstring, but the docstring currently
   asserts a property the code does not have, which is F6's defect in prose form.
3. **N5** — correct the "known misses" list to match measurement (line continuation is not
   always a miss; `$(( x << n ))` is one).
4. **N3** — inject `heartbeatMs` and pin F10's two behaviours.
5. **N4** — pin that no non-grade session route emits a checkpoint id in exam mode.
6. **N6** — make `/reset` and `/hint` phase-aware (or document why a finished session may still
   move its clock and its rung).
7. Optional, cheap, and worth it: **N7** (a `serveOptions` seam) and **N9** (pin 028's sketch).

Nothing in this list is a re-litigation of the original review or of the rulings, and nothing in
it says a shipped grader or a shipped hint is wrong today. Every measured behaviour of the five
shipped tasks is correct on this commit.

## One note on the rulings

You invited me to say if one of them is wrong. They are not — F7's reasoning (gating the concept
library would recreate the problem the app exists to solve) holds, ruling 3's extraction bought
exactly what it claimed (the `HOST` test now fails when `hostname` is dropped, which is the
single most valuable assertion in the diff), and the `'0x50'`/`' 22 '` parking is right for a
whole-branch pass. The only thing I would restate is the 028 note, above: it reads as a worse
outcome than it is.
