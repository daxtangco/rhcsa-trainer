# Task 22 — final scoped verification (fix rounds 2 and 3)

Repo: `/home/daxtangco/rhcsa-trainer`.

Task 22 authored four graded lab tasks and eight concept cards. A full review passed
it with 14 findings; a scoped re-review then **APPROVED** fix round 1 and named four
residuals. Rounds 2 and 3 closed those. **You are the last gate before Task 22 is
marked complete and Tasks 23-25 build on this content bank.**

This is a scoped verification, not a fresh review. Your question: did rounds 2 and 3
close what they claim, and did they break anything? Do not re-audit content the
earlier passes already cleared. Report anything genuinely new, but label it new and
out of scope, and do not withhold approval of the fixes over it.

## Inputs

1. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-22-fix-2.md` — my ruling
   for round 2 (items R1-R5).
2. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-22-fix-3.md` — my ruling
   for round 3 (item R6).
3. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-22-fix-1-report.md` —
   **sections 8 and 9** are rounds 2 and 3. Earlier sections are rounds 1 and F15.
4. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-22-rereview.md` — the
   prior re-review, whose residuals became R1-R5. Its method is the standard here.
5. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/review-decf75d..9300d2b.diff`
   — the diff, 2 commits, 23892 bytes.

## The two commits

- `850c567` — R1-R5, plus **two scope extensions I accepted**: R1's permanent half in
  `019/setup.sh`, and two `017/setup.sh` sites found by sweeping.
- `9300d2b` — R6: `028/setup.sh` now breaks the default-route connection instead of
  whichever profile sorts first.

## Verdict required

A **per-item disposition** — CLOSED / PARTIALLY CLOSED / NOT CLOSED — for **R1, R2,
R3, R4, R5, R6**, plus the three sweep sites (call them R4b `017/setup.sh`
`stamp-enabled`, R4c `017/setup.sh` `sshd-intact`, R1b `019/setup.sh` permanent half).
Then one overall verdict: **APPROVED** or **CHANGES STILL REQUIRED**.

## What to check, in priority order

### 1. R6 — reproduce the shape table. This is the highest-value check you can make.

`028/setup.sh`. Selection is now: `ip -o route show default` → device, then
`nmcli -g GENERAL.CONNECTION device show "$dev"` → the owning profile, with `--`
treated as none. The implementer reports the old form selecting `lo` in **6 of 8**
synthetic shapes and the new form in none:

```
lo sorts first (the hazard)          old=lo        new=ens160
NIC sorts first                      old=ens160    new=ens160
lo first, name has spaces            old=lo        new=Wired connection 1
only lo ACTIVE, NIC route exists     old=lo        new=ens160
only lo managed, no default route    old=lo        new=LOUD-FAIL
nothing at all                       old=LOUD-FAIL new=LOUD-FAIL
route device owned by NO profile     old=lo        new=LOUD-FAIL
two default routes                   old=lo        new=primary
```

Build your own synthetic harness and reproduce it. The two rows that matter are the
ones going from `lo` to `LOUD-FAIL`: a guest that cannot run the task must stop with
the checklist wording rather than break loopback and report success. **Add at least
two shapes of your own that the table does not contain** and say what they do — the
table was written by the person being checked.

Also verify the parse of `ip -o route show default` real output shape (`default via
X dev Y proto Z metric N`) and that field extraction does not depend on a fixed
column position that a `metric`, `proto`, or `onlink` token would shift.

### 2. R6's single-derivation claim, and the guard it deliberately kept

The implementer removed a second derivation of `$dev` (the zone block had re-derived
it from `$conn` through `GENERAL.DEVICES`) so `$dev` is derived once at the top. Verify
that: **grep every use of `$dev` and `$conn` in the file** and confirm there is exactly
one derivation of each and no path that reaches a use before its assignment.

It also deliberately kept a now-unreachable empty-`$dev` guard, with this stated
reason: on an empty `$dev` the zone `awk` compares every interface against `""`,
matches nothing, and **passes** — so the guard is what stops a future reordering from
silently disabling the check. **Verify that claim about the awk**, because if it is
wrong the guard is dead code being justified by a fiction, and if it is right the
guard must stay.

### 3. R2 — the sentinel that was almost shipped

`users/006/grade.sh`. The first version of this fix used a `want=unavailable` sentinel,
which meant a shadow field 8 literally reading `unavailable` would have **passed**. The
shipped form guards on `want_epoch` directly. Verify: no value of field 8 can produce a
pass when `date` produces nothing, and the normal path is unchanged (F1's arithmetic
must still be correct — 20998 local here, and the comparison still rejecting a day
early, a day late, and an unset expiry). Reproduce the "4 of 4 checkpoints emitted vs 0
of 4" claim.

### 4. R4 and the sweep — the fail-open I mis-graded, and the mirror F15 broke

I ruled R4 a three-line consistency edit. The implementer measured it as a fail-open:
`state` captures stderr, so on a two-line capture whose first line is `enabled`, the
`!=` form compares the whole blob, stops matching, and setup proceeds believing httpd
is disabled while `httpd-enabled` passes at baseline. **Verify that mechanism** — it is
the reason a "cosmetic" ruling of mine was wrong, and I want it confirmed or corrected
by a second party.

Then verify the sweep's completeness claim, which is the round's central assertion:
**all eight `is-enabled` sites — four graders, four setups — now use one spelling, and
zero `is-enabled … &>/dev/null` and zero `!= "enabled"` remain outside comments.** Grep
for it yourself across all of `content/tasks`. R4c is the important one: the `decf75d`
(F15) commit made `sshd-intact`'s grader strict and left its setup mirror loose, so
setup accepted `static`, `indirect`, `generated`, `alias` and `enabled-runtime` where
the grader now rejects them — which would fail the invariant for every fixture, and is
a direct violation of mandate 9's requirement that a precondition be the exact negation
of what the grader accepts. Confirm the mirror is now exact **in both directions**.

### 5. No checkpoint drift — the standing hard constraint

Verify at the standing scope, which is now every `.sh` under `content/tasks` carrying a
header: **21 files, 26 header lines** (5 `baseline-fail`, 16 `expect-fail`, 5
`unprobed-invariant`), all byte-identical to `9d2dc22`. Also: `sshd-intact` absent from
every `# baseline-fail:`, and `# unprobed-invariant:` intact at `017/grade.sh:36`.

Produce the five declared/emitted pairs with **your own extractor** covering `ck`,
`ck_pass`, `ck_fail` and `ck_skip` — expected `selinux/019` 8/7, `storage/014` 5/2,
`systemd/017` 5/3, `troubleshooting/028` 5/4, `users/006` 8/7 — and note that
`# baseline-fail:` headers are **comma-separated**, not whitespace-separated. See item
7 for why that matters.

### 6. R1, R1b, R3, R5

R1: `019/setup.sh` device derivation, default route primary and `lo` excluded from the
fallback; the claim is the old form returned `lo` in 5 of 8 shapes. R1b: the permanent
half three lines below had the identical hole via `-g NAME connection show --active`
and now asks which profile owns `$dev`. Check both, and check the `ip -o route` line in
`019` is byte-identical to `028`'s — the implementer says it verified this by string
comparison rather than by eye; do the same.

R3: comment only. The old comment claimed a colon in the profile path was safe;
measurement says `nmcli` writes `\:`, the `awk` does not un-escape, and `sed` exits 2.
Confirm the new comment states what the code does. **Then check the same class in R6's
own new code**: the implementer discloses that a colon in the route-carrying profile's
*name* comes back as `\:` and `$conn` keeps the backslash — not handled, claimed
fail-closed via `need sudo nmcli connection modify "$conn"` exiting loudly. Verify it
is fail-closed and not fail-open, and that the old form had the identical exposure so
this is unchanged rather than introduced.

R5: `task-22-report.md:118` and `:174` corrected in place with a parenthetical naming
F7 and F13.

### 7. The implementer's two disclosed checking errors — verify the corrected numbers

It disclosed both unprompted, which is the behaviour I want. Your job is the numbers,
not the praise:

1. Its post-commit cross-check split `# baseline-fail:` on whitespace where the headers
   are comma-separated, so every goal id carried a trailing comma and it printed
   `UNPROBED-GOAL` for all 22 ids across all five tasks. Re-run with `tr ',' '\n'` was
   clean. **Confirm zero `UNPROBED-GOAL` with a correct comma-aware extractor, and
   confirm the count is 22 goal ids across the five tasks.**
2. Its out-of-scope check first ran over `9d2dc22..HEAD` and flagged
   `scripts/guest-provision.sh` — that is my own `85bf671`, not the implementer's.
   Confirm the out-of-scope set is empty over `decf75d..9300d2b`.

This is the third self-disclosed measurement-tool error in this task (the first was an
extractor matching only the `ck ` wrapper form). All three failed loud. Say whether you
think the pattern indicates the reported numbers should be trusted less, and give a
reason either way — I would rather have your judgement on that than a diplomatic
answer.

## Gates to run yourself

Do not accept the reported numbers:

- `npm run typecheck` — exit 0.
- `npx vitest run` — **246 passing / 23 files**.
- `bash -n` over every script in the diff.
- `node src/cli/index.ts coverage` — exit 0, no `problem:` lines, and the tuple
  5 tasks / 10 concepts / 68 objectives / 58 uncovered / 0 untaught.
- Out-of-scope must be empty for `src/`, tests, `scripts/`, `package.json`,
  `objectives.yaml`, `content/lib/assert.sh`, `docs/`, and
  `content/tasks/storage/014-grow-home-lv/` over `decf75d..9300d2b`.
- `git status --porcelain` empty before and after. **Do not mutate the repo.** Measure
  in `/tmp` (copy the tree with `node_modules` symlinked back) or with synthetic stdin
  and throwaway scripts, which is what the prior passes did.

## Prohibitions

No VM operation of any kind, no `vmrun`. Do not run `scripts/provision.sh` (it powers
on a VM and copies 10 GB). Do not run `ssh-keygen` or write anything into
`/home/daxtangco/.ssh/` — `provision.sh` resolves `RHCSA_SSH_KEY` against the real
`$HOME`, and a previous reviewer created a real keypair there. Do not create or read
`.env.local`. No `shellcheck` (not installed; five tasks confirmed it). No `sudo` (no
TTY). No subagents. `npm run validate` cannot run — no VM, no ISO — and its absence is
not a finding.

## Environment

The Bash tool runs **zsh**: unquoted `$var` does not word-split, `grep --include='*.ts'`
needs quotes, use `bash -s <<'EOF'` for bash semantics. `ls` is aliased to **eza** — use
`/bin/ls`. npm scripts run under `/bin/sh -> dash`. `set -o pipefail` is POSIX-2024 and
works in both shells; `${PIPESTATUS[0]}` is bash-only. `124` project-wide means "timed
out". No `nmcli`, no `firewall-cmd`, no `systemd` on this host — anything depending on
their real output is reasoned, not measured, and should be labelled that way.

## The bar

The defect class this project keeps producing is **a tool reporting success when it did
not do what was asked.** In this task that has now appeared as: a grader passing a wrong
date, a precondition nobody wrote, a solution exiting 0 having done nothing, a setup
that would have broken loopback and reported success, three measurement scripts that
under-reported, and four rationales of mine written for paths I had not executed. For
every item, ask whether it can still report a pass where the state is wrong, or a fail
where the state is right — and label each of your own conclusions **measured** or
**reasoned**. A "verified" label on reasoning is the failure that produced this whole
sequence.

## Report

Write to `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-22-verify.md`.

Return only: the overall verdict, the per-item table, anything not closed, anything new
with its scope stated, and your answer on whether the three disclosed tooling errors
should reduce trust in the reported numbers.

If one of my rulings in `task-22-fix-2.md` or `task-22-fix-3.md` was wrong, say so
directly. Four of mine were wrong in this task and every one was caught by a reviewer
rather than by me.
