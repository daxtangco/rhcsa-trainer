# Task 23 — scoped re-review of fix round 3

Repo `/home/daxtangco/rhcsa-trainer`, branch `phase-0-1`, range **`8083796..2cfbe8b`** (1 commit).

## Why this pass exists, and why it is not paranoia

`countCheckpoints` in `src/server/session.ts` has produced **four** fail-open or fail-closed
defects across three fix rounds, and **each round's fix introduced the next one**:

| round | fixed | introduced |
|---|---|---|
| 1 | F4 (compared line count to distinct-id count), F16 (missed `;`/`&&`/`\|` separators), heredoc over-count | N1, N2 |
| 2 | F17 (`ck lv_size` next to `ck lv` counted as one id) | — |
| 3 | N1 (unanchored quote-blind heredoc opener), N2 (phantom id from a separator inside a string) | **this is what you are here to find out** |

Round 3 did not patch that function — it **rewrote** its scanner. `withoutComment` is deleted and
comments, quotes and heredocs are now one left-to-right walk (`scanLine`). That is the right shape,
and it is also the third consecutive rewrite of the branch's most defect-dense function.

Everything this counter feeds is a truth claim made to a student about whether they passed. An
under-count deflates `expectedTotal`, so a grader killed partway matches it, `incomplete` stays
`false`, and **a student who changed nothing is told the task passed**. An over-count reports a
correct solution as incomplete. There is no third outcome where a miscount is harmless.

## A conflict of interest you must know about

The scan in this commit was built from a recipe **the previous reviewer wrote**, including the two
naive variants it had already measured as wrong. That reviewer therefore cannot approve this
commit — it would be reviewing its own design. **You are a fresh pair of eyes on a fix whose author
was the last reviewer.** Do not treat its recipe as a specification that was met; treat it as one
design that may or may not be correct, and test the code in front of you.

## Inputs

1. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/review-8083796..2cfbe8b.diff` — 1 commit,
   50735 bytes, full context. **Read this, not `git diff`.**
2. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-fix-3.md` — the brief round 3 was
   written against. Nine findings (N1-N9), one ruling.
3. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-rereview.md` — the review that
   produced N1-N9, with every measurement quoted against an `ab32303` control.
4. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-report.md`, `## Fix round 3` — the
   implementer's account. A claim to test, not evidence.

## Verdict required

**APPROVED** or **CHANGES REQUIRED**, plus a table: N1-N9, each FIXED / NOT FIXED / REGRESSED.

## Priority 1 — attack the new scanner directly

This is most of the value of this pass. Spend your effort here.

**Do not verify by reading the walk and agreeing with it.** Drive `countCheckpoints` with inputs
and compare numbers. Build a table of shapes and expected counts, and derive the expectations from
what a **real bash grader would emit at runtime**, not from what the scanner looks like it does.

Already measured green by me at `2cfbe8b` — reproduce these as your baseline, then go past them:

```
echo "a << b"            + ck real-id   → 1     (was 0 at 8083796)
printf "ok; ck phantom"  + ck real-id   → 1     (was 2)
printf "a # b"; ck real-id              → 1     (was 0 — the implementer found this one itself)
cat <<'EOF' … ck x … EOF + ck real-id   → 1     (heredoc body still skipped)
cat <<EOF   … ck x … EOF + ck real-id   → 1
grep -q x <<<"$perm"     + ck real-id   → 1
ck_pass 'home-from-lv' "…"              → 1     (quoted id must survive)
test -f /etc/fstab; ck gamma            → 1
true && ck delta                        → 1
ck lv_size + ck lv                      → 2     (F17 collision)
# ck nope  + ck real-id                 → 1
```

Then go hunting. The three orderings the docstring calls load-bearing are the seams to attack: the
`<<` read happening **before** quote handling, the `ck`-precedes-quote exception that keeps a
quoted id, and the comment cut happening inside the same walk. Each one is a rule with an edge.
Shapes worth trying, and anything else you think of:

- An **escaped** quote inside a quoted run: `echo "it\"s ok; ck phantom"`. Does the run close early
  and re-expose the phantom?
- A single quote inside a double-quoted run and vice versa: `echo "don't; ck phantom"` — an
  apostrophe is not a quote opener inside double quotes, but does this scanner know that?
- An **unterminated** quote: `echo "oops` followed by `ck real-id`. Does the rest of the file
  vanish? That is the N1 failure shape through a different door.
- The `ck`-before-quote exception used as a **weapon**: `printf "x" ; ck "phantom" ; echo "y"`, or
  anything where a real `ck` token precedes a quote whose content then gets scanned for more ids.
  Can one line declare two ids from one call?
- A heredoc delimiter that is **also** a quote shape, and a heredoc whose body contains the
  terminator indented (`<<-EOF` with a tab-indented `EOF`). Does the body end where bash ends it?
- A heredoc that is **never terminated**.
- `<<` where the delimiter is quoted with the *other* quote: `<<"EOF"`.
- Two heredocs on one line: `cat <<A <<B`.
- A `ck` on the **same line as** a heredoc opener, before it: `ck real-id "d" $?; cat <<EOF`.
- The disclosed residual, precisely: I measured `$(( 1 << shift ))` → **0** but
  `$(( bytes << 3 ))` → **1**, because the anchored opener requires `[A-Za-z_]` after `<<`. So the
  residual is narrower and stranger than either document states — a shift by a **variable**
  under-counts, a shift by a **literal** does not. The docstring at `session.ts:66-71` gives the
  identifier example explicitly, which I judged adequate. **Say whether you agree**, given N5's
  whole point was that a false disclosure is worse than a disclosed miss. If you think a grader
  author could read that comment and write an unsafe shape believing it safe, that is a finding.

For each defect you find, state the direction (**fail-open** = under-count = a false pass, or
**fail-closed** = over-count = a false fail), and whether any grader in the bank reaches it today.

**The six invariants must not move. Re-measure them yourself**, standalone and via
`assertLib + grade.sh`: `countCheckpoints(content/lib/assert.sh) === 0`, and 019=8, 014=5, 017=5,
028=5, 006=8. I measured all six unmoved at `2cfbe8b`; confirm rather than inherit. If one moved,
that outranks everything else in this review.

## Priority 2 — do the new pins have teeth?

Round 3 added 12 tests. Several exist specifically because the thing they cover was previously
**unpinned while passing**, which is the defect N3, N4 and N7 each named. A toothless new pin here
is the same defect re-committed, so mutation-test each one:

- **N3** — delete the whole heartbeat block (interval, `pong` handler, `terminate`,
  `clearInterval`) and confirm a test now fails. Before round 3 this left `terminal.test.ts` at
  12/12. Also delete only the `ws.terminate()` branch.
- **N4** — add `result: s.result` to `view()` in a scratch copy and confirm the new pin fails.
  This is the one that protects Task 24 from shipping the exam answer key by adding one field.
  The implementer says the pin reads `app.routes` and asserts the filtered list first — check that
  the filter cannot silently become empty and pass vacuously.
- **N7** — delete `hostname: HOST` from the **production** call path and confirm a test fails.
  Before round 3, the `HOST` test had teeth only for its own `serve` call while `index.ts` deleted
  for free. The claim is `serveOptions` closed that; the check is whether the test observes the
  production line or merely a second copy of the same logic.
- **N5's over-arrival warning** — confirm it fires when distinct ids exceed `expectedTotal`, and
  that it does **not** fail the grade (the count is the suspect, not the machine).
- **N9** — revert the quote-stripping in `content.ts` and confirm the 028 sketch pin fails.

## Priority 3 — the N6 ruling, as implemented

I ruled against the previous reviewer here: **`/reset` refuses a finished session with 409;
`/hint` stays open.** Rationale, which you should test rather than accept: `rating` at
`app.ts:294-304` is a local derived at finish and never stored, `/finish` is already 409 on a
second call, and `MAX_RUNG` is 2 for exam and 3 for drill, so post-finish disclosure cannot reach
solution content in the graded modes. In practice mode reaching rung 5 after your attempt is scored
is the product working — this app exists so its user never opens a book.

Check: that `/reset` on a graded session is 409 and `startedAt` cannot move past `endedAt`; that
`/hint` on a **finished practice** session still returns 200; that no path reveals a checkpoint id
or a second rating in exam mode. **If you can produce a stored value that a post-finish rung
contradicts, my ruling is wrong and I want to know.**

## Gates — run them, do not cite the report

- `npm run typecheck` → exit 0. I measured 0.
- `npx vitest run` → I measured **337 passed / 28 files**, 0 skipped, up from 325/28. Confirm.
- `node src/cli/index.ts coverage` → exit 0, zero `problem:` lines.
- **No new `as` casts, no non-null `!`, no `enum`/`namespace`/parameter properties/decorators.** I
  measured the round-3 diff as adding zero of each. Note: the absolute cast figures in earlier
  documents ("src 5 / test 29") are **counts of a specific pattern, not of all casts** — do not
  chase them. The claim to check is that this commit adds none.
- Nothing modified under `content/`, `src/cli/`, `objectives.yaml`, `content/lib/assert.sh`,
  `src/engine/grading/grader.ts`. `package.json` untouched.
- `git status --porcelain` empty before and after. **Do not mutate the repo** — mutation-test by
  copying the tree to `/tmp` with `node_modules` symlinked back.

## Out of scope — do not report these

F7 (`/api/concepts/:id` stays ungated by ruling), F13/F14/F15, the `'0x50'`/`' 22 '` port parsing,
the seven pre-existing `.pathname` test files, `src/engine/grading/grader.ts`, and everything in
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/whole-branch-parked.md`'s "Residuals that are
documented on purpose" section — the unquoted-delimiter redactor case
(`sed -i s\|a\|b\| /etc/hosts`), the `for u in`/`case` label noise, the `vmrun.ts:108` argv
exposure, and the `sh -c` wrapped-command sketch. The `then`/`do`/`else`/`{`/`(` under-count group
is **settled as an adequate disclosure** (43 `ck` call sites, all at column 0 or indented) — do not
re-open it, but do check the disclosure's *wording* is still accurate after round 3 edited it.

## Prohibitions

No VM operation, no `vmrun`, no `scripts/provision.sh` (it powers on a VM and copies 10 GB). Do not
run `ssh-keygen` or write into `/home/daxtangco/.ssh/`. Do not create or read `.env.local`
(git-ignored, may hold the user's real VM password). Do not read `.env`, `.env.sandbox` or
`.env.example` under `/home/daxtangco/sechelp-tools` — an unrelated project. No `sudo` (no TTY).
No subagents. Do not leave a server listening. `shellcheck` is not installed — not a finding.
`npm run validate` and `npm run test:vm` cannot run without a VM; their absence is not a finding.

## Environment

Bash tool runs **zsh**: unquoted `$var` does not word-split, `grep --include='*.ts'` needs quoting,
plain `grep -n "a\|b"` errors under ugrep (use `grep -nE`), a failed glob is an error not an empty
expansion, `bash -s <<'EOF'` gets bash semantics. `ls` is aliased to **eza** — use `/bin/ls`. npm
scripts run under `/bin/sh` → dash. Node **v22.23.2**, vitest 3.2.7, TypeScript 5.8. `124` means
timed out. `react`, `react-dom`, `@testing-library/react`, `jsdom`, `tailwindcss`, `@xterm/xterm`
are **not installed** — Task 24 owns them.

## The bar

Label every conclusion `measured` or `reasoned`. The recurring defect class in this project is **a
tool reporting success when it did not do what was asked** — and the counter is where it keeps
happening, because a wrong count is silent by construction. The previous two reviews of this
function each found a real fail-open defect that all tests passed over. Assume there is a third
until you have tried hard to find it and failed.

## Report

Write the full review to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-rereview-3.md`.

Return only: the verdict, the N1-N9 table, each new finding with severity + direction (fail-open /
fail-closed) + a one-line failure scenario + whether the bank reaches it today, your answer on the
`$(( ))` disclosure's adequacy, and whether my N6 ruling survives. If it does not, say so plainly.
