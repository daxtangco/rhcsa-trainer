# Task 23 — fix round 3

The scoped re-review of your two fix rounds came back **CHANGES REQUIRED**. Read
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-rereview.md` — it is the
specification for this round. Every finding in it is measured against an `ab32303` control and
every claim about a test's teeth was proved by breaking the code.

**Start from the good news, because it should tell you where to spend your care.** All 17
findings are correctly dispositioned. All three HIGH fixes are real and were re-proved by
execution, not by reading. Nothing parked was touched. The gates reproduce: typecheck 0,
**325 passed / 28 files**, 0 skipped, coverage 0 with no `problem:` lines, no added casts,
porcelain empty. Both pinned invariants hold. The reviewer also checked all five bank sketches
and confirmed the redactor did not start hiding real commands.

What earns CHANGES REQUIRED is one surface: **`countCheckpoints` closed two directions and
opened two new ones**, both regressions against `ab32303`, and one of them is the same defect
class F8 fixed one file over. That is the thing to internalise — the counter has now produced
four separate fail-open/fail-closed defects (F4's unit, F16's under-count, F17's collision, and
now N1/N2). It is the most defect-dense function on the branch. Treat every edit to it as
requiring a measurement in both directions, not one.

Head is `8083796`. Same commit discipline: stage by name, never `git add -A`, explicit identity
inline.

---

## FIX — N1 and N2, the two counter regressions

Do these as one edit; the reviewer measured that a single change closes both.

**N1 (fail-open, MEDIUM).** `src/server/session.ts:61`'s `HEREDOC_START` is unanchored and is
applied to a line whose quoted runs are still intact — `content.ts:65` is the anchored version,
because F8 measured what the unanchored one does. So a `<<` that is not a heredoc opener opens a
phantom heredoc in the counter and discards every remaining line. Measured, `ck` at column 0 in
both cases so only heredoc handling can move the number:

| script | `8083796` | `ab32303` |
|---|---|---|
| `want=$(( 1 << shift ))` then `ck real-id …` | **0** | 1 |
| `echo "a << b"` then `ck real-id …` | **0** | 1 |

A grader containing either shape declares fewer checkpoints than it has, a truncated run matches
the deflated `expectedTotal`, `incomplete` stays `false`, and a student who changed nothing is
told the task passed. `expectedTotal` is the only thing mandate 7's guard has.

**N2 (fail-closed, MEDIUM).** Your widened `CK_CALL` counts a phantom id when a separator
precedes `ck` **inside a string** — which falsifies the exact sentence at `session.ts:38-39`
saying the counter is blind to `ck` in a string "since no separator precedes it there". Adding
the separator alternation is what made that untrue.

| script | `8083796` | `ab32303` |
|---|---|---|
| `printf "ok; ck phantom-id\n"` then `ck real-id …` | **2** | 1 |
| `echo "done; ck it later"` then `ck real-id …` | **2** | 1 |

A grader that prints a progress line containing `; ck ` declares one checkpoint too many, so a
complete run on a correctly solved machine reports `incomplete` and forces `allPassed: false` —
a false fail, the direction your own F4 comment names as the one to avoid. The shipped tests
only pin separator-free strings (`# ck nope`, `ck real … # ck nope`), which is why this passed.

**The fix the reviewer measured green.** Reuse the single-pass scan `commandSketch` already uses,
with one addition: a quote directly following a `ck` token is quoting the **id** and must be
kept — `ck_pass 'home-from-lv' "…"`, which your own `GRADE_BRANCHED` fixture contains. Replace

```ts
const code = withoutComment(raw).replace(/<<</g, ' ')
const started = HEREDOC_START.exec(code)
if (started?.[2] !== undefined) heredoc = started[2]
```

with a scan that walks the line once: at `<<<` emit a space and skip 3; at `<<` read the
delimiter with the **anchored** regex against the remaining slice *before* any quote handling
(so `<<'EOF'` still opens a heredoc), emit a space and skip 2; at a quote, empty the run unless
`/ck(?:_pass|_fail|_skip)?[ \t]+$/` matches what has been emitted so far.

**Two naive variants do not work and the reviewer measured both, so do not rediscover them:**
emptying quoted runs without the `ck` exception breaks `GRADE_BRANCHED`'s quoted id, and
emptying them before reading the delimiter breaks `<<'EOF'`.

Its measured result: 325/325, all six invariants unmoved, `echo "a << b"` → 1,
`printf "ok; ck phantom-id\n"` → 1, real heredoc bodies still excluded, separator and `&&` forms
still counted, the F17 prefix collision still 2, `<<<"$perm"` still 1.

**Pin every one of those, both directions.** Each new test must fail if you revert the scan —
say in your report which ones you proved that way.

**Fold N8 in here.** Deleting the `startsWith('<<<')` branch in `content.ts`'s `scanLine` leaves
`content.test.ts` at 19/19, because the anchored `HEREDOC_START` already refuses `<<<` (the
character after `<<` is `<`). Keep the branch as defence in depth, but give the herestring
assertion teeth of its own or state in a comment that the anchoring is what refuses `<<<`. A
test that passes with the branch deleted is not testing the branch.

**One residual survives this fix and that is accepted:** `$(( 1 << shift ))` still under-counts,
because the `<<` is not inside quotes — closing it needs the opener recognised only in a redirect
position. Disclose it, accurately, per N5.

## FIX — N5, the known-misses list is wrong in one direction and silent in another

`session.ts:53-55` lists "a `ck` after `then`, `do`, `else`, `{`, `(` or a line continuation".
Measured: the first five are genuine misses. **A line continuation is not a miss** — `test -f /x \`
followed by `  && ck cont-id "d" $?` counts **1** (base 0), and `true \` + `  ck cont2-id` counts
1. And `$(( x << n ))`, which *is* a miss, is not listed at all.

Correct the list to match measurement, and add the `$((` shift case. A future grader author who
trusts this list and writes the shape it calls safe gets silently under-counted — the fail-open
direction.

**Do not change the pattern to cover the `then`/`do`/`else`/`{`/`(` group.** The reviewer settled
the reachability question the way I asked it to and the answer is that the disclosure is enough:
43 `ck` call sites across the five graders, every one at column 0 or indented, nothing in
`content/` or `docs/` matching `(then|do|else|\{|\()[ \t]+ck`, and `assert.sh` documents only the
comment form and the separator form — and the separator form is now counted, which was F16's
whole point. **The disclosure was inadequate only because two of its specifics were false.**

Also from N5, add it: `total` may exceed `expectedTotal` and nothing notices — 5 distinct ids
arriving against a declared 3 gives `incomplete: false, allPassed: true`. **Over-arrival is the
observable runtime signature of an under-count**, i.e. of N1 itself. Emit a warning line when
`status.size > expectedTotal` naming both numbers. Do not fail the grade on it: the count is the
suspect, not the machine. Had this existed, N1 would have surfaced at runtime instead of in a
review.

## FIX — N3, F10's heartbeat is pinned by nothing

Deleting the **entire** heartbeat block — interval, `pong` handler, `terminate`, `clearInterval` —
leaves `test/server/terminal.test.ts` at **12 passed (12)**. Deleting only the `ws.terminate()`
branch also leaves 12/12. So a later edit can drop it and CI stays green while a closed laptop
leaves `ssh -tt` and a guest PTY alive indefinitely.

The seam already exists in the file's own style: `TerminalDeps.spawnPty` is documented as an
"injection point for the tests". Add `heartbeatMs?: number` beside it and pin the two behaviours
the reviewer measured by hand: no pong for two beats → `terminate` **and the pty killed**; a
responsive socket survives. Prove both fail with the block deleted.

## FIX — N4, pin the property F3 exists to protect on the routes F3 did not gate

Adding one field to `view()` (`result: s.result` at `app.ts:312-324`) publishes the full unmasked
checkpoint list — ids, descriptions, statuses — through `GET /api/sessions/:id` **and** `/reset`,
in exam mode, before any finish, and the whole app suite stays at **18 passed (18)**.

The code does not leak today; the reviewer measured that no route other than `/finish` emits a
checkpoint id in exam mode. Nothing holds it there. **Task 24 is the live risk**: it needs one
more field on the Lab screen, the obvious edit adds `result` to `view()`, and the exam answer key
ships to the browser with a green build.

Pin it: assert that the serialised body of **every** non-grade session route in exam mode
contains neither checkpoint id. Write it so it covers routes added later, not just today's list.

## FIX — N6, but only half of it. Read the ruling.

**Ruling: `/reset` refuses a finished session. `/hint` stays open. — Because the rating is
derived at finish and never persisted, so a later rung cannot corrupt it, and a finished practice
lab is exactly where this app is supposed to keep teaching. — Cost if wrong: a student reads
rung 5 after finishing and the `rung` field in a later view sits above the `rungUsed` the rating
was built from.**

The reviewer proposed 409 on both routes. I checked the code before ruling and the two halves are
not alike, `MEASURED`:

- **`/reset` on a graded session is incoherent and gets the 409.** `restart(s.id, deps.now())`
  moves `startedAt` to 4000 while `endedAt` stays 3000, so anything computing `endedAt -
  startedAt` gets a negative duration. And `/reset`'s own comment at `app.ts:211-214` already
  argues this exact principle for the rung — "the rating derived at finish stops describing the
  attempt that actually happened" — it just never applied it to the clock. Use the same message
  shape as the two existing 409s. There is no learning use for resetting a finished session's VM;
  you start a new session for that.
- **`/hint` keeps working after finish.** `rating` at `app.ts:294-304` is a **local**, returned
  once, and `/finish` is now 409 on a second call — so no stored rating exists for a later rung to
  contradict. `rungUsed: s.rung` was captured at derivation time. Meanwhile the caps do the
  containment: exam is `MAX_RUNG` 2 and drill 3, so post-finish reading cannot reach solution
  content in the graded modes, and in practice mode reaching rung 5 after finishing **is the
  product** — the user built this app so they would not have to open a book, and the moment
  they most want the full solution is right after their attempt is scored.

So: 409 on `/reset` only, and add a comment at `/hint` in the same voice as `:211` stating that
disclosure after a finish is deliberate, that the rating is already derived and unpersistable,
and that the mode caps are what keep it honest. **Do not add a 409 to `/hint`.** Add a test for
both halves — the `/reset` refusal, and `/hint` still returning 200 on a finished practice
session.

## FIX — N7 and N9, both cheap and both worth it

- **N7.** Your `HOST` test has real teeth for what it covers — dropping `hostname` from its own
  `serve` call fails it with `expected '::' to be '127.0.0.1'`, the exact original measurement.
  But `index.ts:38` is the line that actually binds, `index.ts` cannot be imported by a test
  (four side effects), so deleting `hostname: HOST` from **production** breaks nothing. That is
  the last link in the control ruling 3 existed to pin. Export a `serveOptions(fetch, port)` from
  `config.ts`, have `index.ts` call it, and assert on it. Prove the test fails when the
  production call stops using it.
- **N9.** `commandSketch over the real bank` pins 014 and 017 exactly and 019 by properties, but
  not `troubleshooting/028` — which is the one solution besides 019 whose sketch **this diff
  changed**. Add the one line:
  `expect(commandSketch(await solution('tasks/troubleshooting/028-…/solutions/01-….sh'))).toEqual(['systemctl', 'firewall-cmd', 'nmcli'])`

Also add one residual to `commandSketch`'s docstring list, which does not mention it: a wrapped
command — `sudo sh -c "systemctl restart httpd"` — sketches as `sh` alone. Measured as
unreachable today (no solution, antisolution or setup script in the bank uses `sh -c` or
`bash -c`), so it is a disclosure, not a fix.

## The 028 sketch degradation — settled, no action beyond N9

I parked it as a content concern and the reviewer agreed, with two corrections that make the
outcome better than I described. **028's rung-4 sketch is three commands, not one** — the *line*
sketches as `nmcli`, but the *task* sketches as `systemctl firewall-cmd nmcli`, measured through
the live `/hint` route. What was lost is `cat`: the only entry that was not part of the task.
028 is about restoring remote access, so those three commands are the whole answer, and "read the
man page for `cat`" was never the hint that saved anyone. And **exactly two sketches in the whole
bank changed** — 019 lost `Listen` and `DocumentRoot`, 028 lost `cat`, and 014, 017 and 006 are
byte-identical. Every command I asked it to check for survived.

Nothing to do here except N9's pin. Do not "improve" the splitter to recover `cat`.

---

## Gates — all must pass before you report

- `npm run typecheck` → exit 0.
- `npx vitest run` → all green, nothing skipped. Baseline is **325 passed / 28 files**; you are
  adding tests, so it goes up and must not go down.
- `node src/cli/index.ts coverage` → exit 0, zero `problem:` lines.
- **No new `as` casts** (src 5, test 29, scripts 0), no non-null `!`, no `enum`, no `namespace`,
  no parameter properties, no decorators.
- **The six invariants must not move.** Re-measure and paste them: `countCheckpoints` over
  `content/lib/assert.sh` → **0**, and 019=8, 014=5, 017=5, 028=5, 006=8. If any moves, your
  scan is wrong — **report it rather than adjusting the expected number.** This is the third
  round in a row where these are the load-bearing check.
- Nothing under `content/`, `src/cli/`, `objectives.yaml` or `content/lib/assert.sh` modified.
  `src/engine/grading/grader.ts` is out of scope. `package.json` untouched.
- `git status --porcelain` empty when you finish, with your work committed.

## Prohibitions

No VM operation, no `vmrun`, no `scripts/provision.sh`. Do not run `ssh-keygen` or write into
`/home/daxtangco/.ssh/`. Do not create or read `.env.local`. No `sudo` (no TTY). No subagents.
Do not leave a server listening. `shellcheck` is not installed — not a finding. The Bash tool
runs **zsh**: `bash -s <<'EOF'` for bash semantics, `/bin/ls` not `ls`, `grep -nE` not
`grep -n "a\|b"`, and a failed glob is an error rather than an empty expansion.

## Report

Append to `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-report.md` under a
`## Fix round 3` heading. Return only: per-finding disposition for N1-N9, the gate results with
the six invariant counts pasted, the new test count, which new tests you proved by reverting the
fix, and anything you could not do.

If you think my N6 ruling is wrong, say so in the report and implement it anyway — unless it is a
correctness problem, in which case stop and tell me.
