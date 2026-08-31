# Task 22 — fix round 1

The Task 22 review returned **spec compliance PASS**, **task quality APPROVE WITH
CHANGES**, 14 findings. Read the full review at
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-22-review.md` — each
finding there has a `**Where.**`, a `**Fix.**`, and a statement of whether it was
measured or reasoned. This file is my ruling on which ones you change and how.

Nothing here is a rejection of your work. The review confirmed all nine mandates
applied, every gate you reported, no objective-id typo in any of the ten cards, and
that your report's numbers were right where two of my mandate's numbers were wrong.
One finding is a genuine bug that would have cost a confusing Step 9; the rest are
hardening.

**Two of my own mandates were wrong and the review caught them.** Mandate 7 item 5
is now struck through and retracted in `task-22-mandates.md` — it told you the
grader's `-u` was load-bearing and instructed you not to re-derive it, and that was
backwards. Mandate 8's "23 scripts" and "203 tests / 20 files" were also stale;
your report's 30 and 246/23 were correct. If a mandate ever tells you something is
"measured clean" and your own reading disagrees, your reading wins — say so in the
report.

---

## Fix these eleven: F1, F2, F3, F4, F5, F6, F7, F8, F9, F12, F13

### F1 (HIGH) — the `carol-expiry` timezone bug. Do this one first.

`content/tasks/users/006-team-provisioning/grade.sh:26-29`. Apply the review's fix
exactly:

```bash
want=$(( $(date -d 2027-06-30 +%s) / 86400 ))
days=$(sudo getent shadow carol | cut -d: -f8)
[ -n "$days" ] && [ "$days" = "$want" ]
```

Keep whatever `ck` wrapper and detail string the checkpoint already has; only the
comparison changes. **Drop the `-u`** — and do not stop at dropping it, because
`days * 86400` is always a multiple of 86400 while a non-UTC local midnight never
is, so dropping `-u` alone breaks the check everywhere instead of in one hemisphere.
The point is to compare *day counts* using the same local interpretation
`strtoday()` used when `chage -E` / `useradd -e` wrote the field.

Verify the arithmetic yourself on this host (`date +%z` reports +0800) rather than
trusting my transcription of it: confirm `$(( $(date -d 2027-06-30 +%s) / 86400 ))`
and `$(( $(date -u -d 2027-06-30 +%s) / 86400 ))` differ by exactly 1, and say both
numbers in your report. Then reason once, in a comment above the check, about why
the local form is the correct one — one or two lines, naming `strtoday`, so the next
reader does not "fix" it back to `-u`.

### F2 (MEDIUM) — `017`'s prompt must ask for what `stamp-effect` measures in verdict A.

`content/tasks/systemd/017-boot-time-service/task.yaml:19-28`. Add one prompt
bullet, in the review's words or your own: *"Make sure it has already run, not just
that it will run at the next boot."*

**No new checkpoint** — mandate 6 still holds, and the checkpoint set is frozen.
This is a prompt change only. A student who writes the unit and runs `systemctl
enable` without `--now` currently fails verdict A for something the prompt never
asked, and both shipped solutions happen to start it so `validate` cannot see the
gap.

### F3 (MEDIUM) — delete the clause that makes `solutions/03` illegal.

`content/tasks/users/006-team-provisioning/task.yaml:25-26`. Delete *"in addition
to their own primary groups"*. Take the review's recommendation, not the
alternative: no checkpoint measures the clause, and restricting `-g devops` to carol
would destroy the whole point of `solutions/03`, which is to prove the membership
checkpoints grade end state rather than mechanism.

I am also settling the question my review-context asked you about: **`solutions/03`
stays a solution.** The reviewer confirmed the grader really does count primary
membership (`grade.sh:14`'s `id -nG` includes the primary group, and `sudo -l -U`
resolves `%devops` through the full group list). The mis-filing was against the
prompt, and the prompt is what changes.

### F4 (MEDIUM) — the firewall default-zone precondition. This is the important one after F1.

`selinux/019/setup.sh` and `troubleshooting/028/setup.sh`. Add one precondition per
task asserting that the zone of the active interface equals
`firewall-cmd --get-default-zone`, failing with the batch's existing *"this guest
was not built to `docs/vm-build-checklist.md`"* wording.

This is the only finding in the review that can make a **student's failure look
like a pass**: `firewall-cmd` with no `--zone` writes the default zone, so if the
NIC is bound elsewhere the checkpoint goes green while the traffic is still dropped,
and `019`'s prompt promises port 82 is "reachable from other machines". That is this
project's named defect class and it is exactly the shape mandate 9 exists to close.

Use the same `need`/`fail` idiom the file already uses. Derive the active interface
the way the rest of the batch derives things — do not hardcode `ens160` or any
device name. If you cannot get the interface reliably in a way you can defend, say
so in the report and assert what you can rather than writing a check whose failure
mode you cannot describe.

### F5 (MEDIUM) — make `028/solutions/02` fail loudly instead of silently succeeding.

`troubleshooting/028-restore-remote-access/solutions/02-by-port-and-keyfile.sh:20-23`.
Add the review's end-state assertion after the `sed`/reload:

```bash
[ "$(nmcli -g connection.autoconnect connection show "$conn")" = "yes" ]
```

Under `set -e` that turns a `sed` that matched nothing on an ifcfg-format profile
into an immediate attributable failure. A solution fixture that exits 0 having done
nothing is the named defect class inside the teaching material, and it would present
as "the grader over-fits" when it is the fixture.

The review also notes the smaller `awk -F:` mis-split on connection names containing
a colon. Fix it if it is cheap and you are confident; if not, leave it and say why —
it fails loudly, which is the acceptable half of that pair.

### F6 (LOW) — the D8 idempotency class, twice more, plus two headers that claim otherwise.

Apply both one-liners from the review: `sudo sed -i '/^[[:space:]]*%devops/d'
/etc/sudoers` before `users/006/setup.sh`'s `visudo` precondition, and
`sudo firewall-cmd --permanent --remove-port=22/tcp &>/dev/null` beside
`028/setup.sh:40`.

**And fix the two file headers in the same pass** — `users/006/setup.sh:2-3` says
"Remove any prior attempt so the task is repeatable" and `028/setup.sh:3-4` says
"Idempotent: every step is already the desired end state on a second run." Those
sentences were not true of a prior *solution* run, only of a prior setup run. A
header asserting a property the file does not have is the same defect class as
everything else in this list, in the place a reader is most likely to trust it. If
after your fix the claim is true without qualification, leave the wording; if it is
true only with respect to what you now clean up, say that.

### F7 (LOW) — apply mandate 9 evenly inside one file.

`users/006/setup.sh`. `alice-maxdays` has an explicit guard against
`/etc/login.defs` already setting `PASS_MAX_DAYS 30`; `carol-expiry`'s exact
analogue, `EXPIRE=` in `/etc/default/useradd`, has none, and your report's table
claimed the row was "covered by carol's absence". With `EXPIRE=2027-06-30` set, a
bare `useradd carol` satisfies the checkpoint. Add the guard the review suggests.
Also correct that row of your report.

### F8 (LOW) — widen the `sudo -l` pattern by one notch.

`users/006/grade.sh:38`. `\((ALL|root)(:(ALL|root))?\)` per the review. `%devops
ALL=ALL` is valid sudoers that grants everything, and `sudo -l` renders it as
`(root) ALL`, which today's pattern rejects. Using `sudo -l` instead of grepping
files was the right call; only the pattern needs widening.

### F9 (LOW) — one spelling of "is it enabled", the strict one.

`selinux/019/grade.sh:11` and `028/grade.sh:13` use the bare exit status of
`systemctl is-enabled`, which is 0 for `static`, `indirect`, `generated`, `alias`
and `enabled-runtime`. Adopt `017/grade.sh:14-15`'s strict form — compare the string
to `enabled` — in both. Three checkpoints for one concept should not be written two
ways, and the strict form is the one that means what the checkpoint's name says.

### F12 (NIT) — reword the comment; do not change the fixture.

`users/006/antisolutions/01-no-group-no-sudo.sh:2-4`. **Reword, do not add the
sudoers rule.** Adding it would change what the fixture actually breaks and put its
`# expect-fail:` declaration in play, which is not a nit-sized change. The comment
claims the `sudo-devops` failure demonstrates coupling between checkpoints; the
script also creates no `%devops` rule, so it fails for two independent reasons and
demonstrates nothing of the kind. These files are teaching material. Say what the
fixture actually does.

### F13 (NIT) — the report is what is wrong, not the code.

Your report section 2's `firewall-ssh` row describes `--permanent --list-services`
and `--list-ports`; the code uses `--permanent --list-all` and greps both spellings,
which is better because it is byte-for-byte the grader's own probe. Correct the row.
No code change.

---

## Do not fix: F10, F11, F14

**F10 — forwarded, deliberately.** The `pipefail` + `grep -q` SIGPIPE hazard is
real in principle and the reviewer's own measurement is why I am leaving it: every
producer in these graders emits at most a few hundred bytes, which fits inside the
64 KiB pipe buffer, so the producer finishes writing and exits 0 before `grep -q`
can close the pipe. Rewriting nine probe sites across four files to close a hazard
that cannot fire on this input is more likely to introduce a new bug than to remove
one. Forwarded to the final whole-branch review, where it can be done as one
deliberate pass across the whole content bank with a test behind it.

**F11 — forwarded to the engine backlog, not yours.** `vmrun.ts:252-292`'s
`guestUp()` only proves VMware Tools can run `echo up`, so verdict B can be graded
before `multi-user.target`. Not Task 22's code and not Task 22's defect. It is at
the top of the review's verdict-B failure table, which is where it belongs.

**F14 — already fixed, by me.** Both wrong numbers were mine. `task-22-mandates.md`
now carries the corrections.

---

## Gates

Re-run everything you ran before and report the real output:

- `npm run typecheck` — exit 0.
- `npx vitest run` — must stay **246 passing / 23 files**. You are touching no TS;
  if the count moves, that is a finding, not a rounding error.
- `bash -n` on every script you touch.
- `node src/cli/index.ts coverage` — exit 0, no `problem:` lines. F3's prompt edit
  and F2's prompt bullet are `task.yaml` changes, so re-run it.
- The declared-vs-emitted id cross-check, both directions. **F1, F8 and F9 all edit
  grader probe lines**, so re-prove that every declared id is emitted and every
  emitted id declared.
- Confirm `# baseline-fail:` lines are unchanged. **No checkpoint is added,
  removed, or renamed in this round.** If you find yourself needing to, stop and
  tell me instead.
- `git diff --stat` against `9d2dc22` before you commit, and confirm you touched
  nothing in `src/`, no test, not `objectives.yaml`, not `content/lib/assert.sh`,
  and nothing under `content/tasks/storage/014-grow-home-lv/`.

Commit as one commit on `phase-0-1` with the identity spelled out inline:

```
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "..."
```

The commit message should name F1 as a bug fix with its measured mechanism, and
list the rest as hardening. Do not let it imply anything was verified against a
RHEL 9 guest — nothing was, and no VM exists.

## Prohibitions, unchanged

No VM operation of any kind. No `vmrun`. Do not run `scripts/provision.sh`. Do not
run `ssh-keygen` or write anything into `/home/daxtangco/.ssh/`. Do not create or
read `.env.local`. Do not touch the user's unrelated Ubuntu or Windows 11 guests.
`shellcheck` is not installed; do not chase it.

## Report

Write to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-22-fix-1-report.md`.
Return to me only: the commit sha, one line per finding saying fixed / not-fixed
with why, the gate results, and anything you disagree with. One table is enough for
the eleven.

For each of the eleven, say explicitly whether you **measured** the fix or
**reasoned** it. F1 is measurable on this host — measure it. Most of the others are
not measurable without a guest, and saying so plainly is the correct answer; a
"verified" label on something you reasoned about is the specific failure that put
F1 in this file in the first place.
