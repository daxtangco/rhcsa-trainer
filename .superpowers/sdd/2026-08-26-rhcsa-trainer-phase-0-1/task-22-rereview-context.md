# Task 22 — scoped re-review

You are re-reviewing the fix round for Task 22 of the RHCSA Lab Trainer plan. Repo:
`/home/daxtangco/rhcsa-trainer`.

**This is a scoped re-review, not a fresh review.** Your question is narrow: did the
fix round close each finding it claims to close, and did it break anything? Do not
re-audit the underlying content the original review already passed. If you find
something genuinely new, report it — but say plainly that it is new and out of the
fix round's scope, and do not treat its existence as a reason to withhold approval
of the fixes.

## Inputs

1. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-22-review.md` — the
   original review, 587 lines. Findings F1-F14, each with a `**Where.**` and a
   `**Fix.**`.
2. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-22-fix-1.md` — my
   ruling: fix eleven (F1-F9, F12, F13), forward F10 and F11, F14 already mine.
3. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-22-fix-1-report.md` —
   the implementer's report, sections 1-6 for the first commit and **section 7** for
   the second. It labels every fix `measured` or `reasoned`.
4. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/review-85bf671..decf75d.diff`
   — the full fix diff, 2 commits, 33350 bytes.

## The two commits

- `1ac01f2` — eleven findings. 10 files, 191 insertions / 29 deletions.
- `decf75d` — **F15**, a finding the implementer found itself and asked about, which
  I then ruled in: `systemd/017/grade.sh:37`'s `sshd-intact` invariant was a fourth
  loose `is-enabled` site that F9 did not name. 1 file, 8 insertions / 2 deletions.

`85bf671` is the BASE and is excluded — it is my own one-line provisioner commit,
not the implementer's, and the original review already passed it.

## Verdict required

State a clear **per-finding disposition** — CLOSED / PARTIALLY CLOSED / NOT CLOSED /
NOT ATTEMPTED (as ruled) — for **F1 through F15**, and then one overall verdict:
**APPROVED** or **CHANGES STILL REQUIRED**. A report without a per-finding table
will be rejected.

## What to check, in priority order

### 1. F1 — verify the arithmetic yourself. This is the whole point of the round.

The fix compares day counts under the writer's local interpretation:

```bash
want=$(( $(date -d 2027-06-30 +%s) / 86400 ))
```

Run the arithmetic on this host (`date +%z` reports +0800). Confirm independently:
the local and UTC day indices differ by exactly 1; the new comparison accepts what
`strtoday()` would store here; and it still **rejects** a day early, a day late, and
an unset expiry. The implementer claims all of this and claims a remainder of 57600
for the local midnight epoch. Reproduce rather than accept.

Then answer the question the fix turns on, and answer it as a measurement or say you
could not: **does the fix hold for a timezone behind UTC as well as ahead of it?**
`TZ=America/Los_Angeles date -d 2027-06-30 +%s` costs nothing to run. The original
review asserted both signs work; verify that claim rather than inheriting it.

Also check the code comment the fix added. It is supposed to name `strtoday` and
explain why the local form is correct, so that a later reader does not "fix" it back
to `-u`. A comment that merely says "do not add -u" without the mechanism has not
done that job.

### 2. F4 — two new parsers, written from scratch, on a path nothing can execute.

The implementer split the check into a runtime half (`firewall-cmd
--get-active-zones`) and a permanent half (`nmcli connection.zone`), on the argument
that `firewall-ssh` and `firewall-permanent` are permanent checks while
`connection.zone` re-binds at boot. I accepted that reasoning. It reports measuring
the zone parser against 6 synthetic shapes and a route parser against 4.

Check the parsers against `--get-active-zones`'s real output format, which is a
two-line-per-zone shape (zone name on one line, `  interfaces: eth0 eth1` indented
beneath). A parser that assumes one line per zone, or that matches an interface name
as a substring of another (`eth1` inside `eth10`), is wrong. Also check the device
derivation is genuinely not hardcoded and behaves when there is no default route.

**The accepted design decision:** an interface appearing under *no* zone is treated
as fine, because firewalld routes it via the default zone. Do not report that as a
finding — it is ruled. Do check the code actually implements that rather than
falling through to a pass by accident.

### 3. F5 — the `nmcli` field split and the end-state assertion.

The fix keys on `connection.uuid` instead of `awk -F:` over `NAME,FILENAME`, and
adds an explicit-message assertion rather than a bare `test` (the implementer's
reasoning: a bare test under `set -e` aborts silently, which defeats the stated
purpose of an attributable failure — that is correct and I accept it). It claims to
have measured the split against a name with spaces, a colon in the path, and ifcfg
paths. Verify the escaping story: `nmcli -g` escapes `:` as `\:` in *values*, and a
parser that strips backslashes indiscriminately will corrupt a path containing one.

### 4. F15 — the fourth `is-enabled` site.

```bash
sshd_state=$(systemctl is-enabled sshd 2>&1)
printf '%s' "$sshd_state" | grep -qx enabled
ck sshd-intact "sshd is still enabled" $? "is-enabled=$sshd_state"
```

The implementer flagged, correctly, that the variable is `sshd_state` and not
`state` because `state` is already live at line 14 for `stamp-enabled` — reusing it
would have clobbered the value that checkpoint's detail string reads. **Verify that
claim by reading the file**: confirm `state` is genuinely still intact for
`stamp-enabled` at its point of use, and that no other variable in this grader was
shadowed by either commit. This is the one place in the round where a careless edit
could corrupt an unrelated checkpoint's diagnostic.

Note the `$?` in argument 3 and the command substitution in argument 4: the original
review confirmed empirically that `$?` expands before argument 4's substitution
runs. That is settled; do not re-derive it.

### 5. No checkpoint drift. This was the round's hard constraint.

I told the implementer: **no checkpoint added, removed or renamed.** It claims the
declaration headers are byte-identical to `9d2dc22` across 5 files, per-task
declared/emitted counts unchanged (`selinux/019` 8/7, `storage/014` 5/2,
`systemd/017` 5/3, `troubleshooting/028` 5/4, `users/006` 8/7), `sshd-intact` still
absent from every `# baseline-fail:`, and `# unprobed-invariant: sshd-intact`
untouched. **Verify this independently** — it is the claim most worth checking
because it is the one I made load-bearing, and because a drifted checkpoint id
breaks Task 23's `countCheckpoints`.

Diff the `# baseline-fail:`, `# expect-fail:` and `# unprobed-invariant:` lines
between `9d2dc22` and `decf75d` directly. `git show 9d2dc22:<path>` is available.

### 6. The implementer's tooling correction — check the numbers, not the story.

Section 7 reports that its own inline id extractor initially matched only the `ck `
wrapper form, under-counted `storage/014` as `emitted=0 goal=2`, and produced two
spurious `UNPROBED-GOAL` lines; it re-ran with both call forms and got 5/2.
`storage/014/grade.sh` calls `ck_pass`/`ck_fail` directly and is untouched by this
round.

It disclosed this unprompted, which is the behaviour I want. Your job is not to
praise it: **independently produce the per-task declared/emitted counts with your
own extractor**, covering `ck`, `ck_pass`, `ck_fail` and `ck_skip`, and say whether
your numbers match the five pairs above. A measurement tool that silently
under-counts is the same defect class as F1, so the numbers need a second source.

### 7. The rest

F2, F3 (prompt edits — check `coverage` still parses the YAML and the deleted clause
is the one named), F6 (two one-liners **and** the two rewritten file headers — check
the new headers claim only what is true), F7, F8 (the accepted wider pattern:
`\((ALL|root)([[:space:]]*:[[:space:]]*(ALL|root))?\)` — confirm it accepts
`(ALL : ALL)`, `(ALL) ALL`, `(root) ALL` and rejects `(ALL : bob)` and `(bob : ALL)`),
F9 (both named sites strict, plus `028/setup.sh`'s mirroring precondition whose
comment claimed "exactly the grader's probe"), F12 (comment only — confirm the
fixture body and its `# expect-fail:` are untouched), F13 (report row only).

F10, F11, F14 were ruled **not to be fixed**. Confirm they were left alone, and mark
them NOT ATTEMPTED (as ruled). Do not reopen them.

## Gates to re-run yourself

Do not accept the reported gate results. Run them:

- `npm run typecheck` — exit 0.
- `npx vitest run` — must be **246 passing / 23 files**.
- `bash -n` over every script in the diff.
- `node src/cli/index.ts coverage` — exit 0, no `problem:` lines.
- `git status --porcelain` — must be empty when you finish. **Do not mutate the
  repo.** If you need to mutate to measure, copy the tree to `/tmp` with
  `node_modules` symlinked back and work there. That is this project's standard
  reviewer technique.
- Confirm nothing in `src/`, no test file, not `objectives.yaml`, not
  `content/lib/assert.sh`, nothing under `content/tasks/storage/014-grow-home-lv/`,
  and nothing in `scripts/` or `package.json` is touched by either commit.

## Prohibitions

- **No VM operation of any kind.** No `vmrun`. No VM exists; the RHEL 9 ISO is not
  downloaded. `npm run validate` cannot run and its absence is not a finding.
- **Do not run `scripts/provision.sh`** — it powers on a VM and copies 10 GB.
- **Do not run `ssh-keygen` or write anything into `/home/daxtangco/.ssh/`.**
  `provision.sh` resolves `RHCSA_SSH_KEY` against the real `$HOME`, so testing past
  its `:?` guards escapes `/tmp`. A previous reviewer created a real keypair there.
- **Do not create or read `.env.local`** — git-ignored, may hold the user's real VM
  password.
- **Do not report `shellcheck`** — not installed, five prior tasks confirmed it.
- **Do not dispatch subagents.** Do the work yourself.
- `sudo` cannot authenticate here (no TTY). Do not try.

## Environment

- The Bash tool runs **zsh**. Unquoted `$var` does not word-split; use
  `bash -s <<'EOF'` for bash semantics. `grep --include='*.ts'` needs the quotes.
- `ls` is aliased to **eza** — use `/bin/ls`.
- npm scripts run under `/bin/sh -> dash`.
- `set -o pipefail` is POSIX-2024, works in bash and zsh. `${PIPESTATUS[0]}` is
  bash-only.
- `124` project-wide means "timed out".

## The bar

The defect class this project keeps producing is **a tool reporting success when it
did not do what was asked**. F1 was exactly that, in a grader, wearing a mandate of
mine that said it had been checked. So: for each fix, ask whether it could still
report a pass where the state is wrong, or a fail where the state is right — and say
which of your own conclusions you measured and which you reasoned. A "verified"
label on reasoning is the specific failure that produced this round.

## Report

Write to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-22-rereview.md`.

Return to me only: the overall verdict, the per-finding disposition as a compact
table, anything not closed, and anything new you found with its scope stated.

If one of my rulings in `task-22-fix-1.md` was wrong, say so directly. Two of my
mandates were wrong this task and the reviewers catching them was worth more than
the mandates were.
