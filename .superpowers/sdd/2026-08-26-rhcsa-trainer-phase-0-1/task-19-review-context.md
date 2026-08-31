# Task 19 — reviewer context

Read `task-19-brief.md` and `task-19-mandates.md` first. **The mandates override
the brief wherever they conflict** — nine numbered required changes. Spec
compliance means compliance with the mandates, not with the brief's original
code.

## Two verdicts are required

Neither is optional and neither substitutes for the other:

1. **Spec compliance** — each of the nine mandates: satisfied, or not, with
   evidence. Name the file and line you checked.
2. **Task quality** — judge this as the person following the checklist at 9pm to
   build the VM for the first time, who has one shot at it and no way to tell a
   script bug from their own mistake.

## This task cannot be run, and that changes what the review is

`provision.sh` needs a VMware VM that **does not exist** — the RHEL 9 ISO is a
user-owned blocker. Its acceptance (Step 5) is deferred by mandate 7. So there is
no test suite to lean on and no way to execute the main path: **reading is the
whole of what this review can catch.** Nobody will find a defect here by running
it until the day the user runs it for real, on the one path where a wrong turn
costs them a rebuilt VM.

That makes prose accuracy a correctness property in this task, not a style note.
Two of the nine mandates (6 and 8) are documentation-only for exactly that
reason.

## Two mandates are load-bearing — check these first

**Mandate 1 — sourcing the template destroyed an exported password.** The
template `provision.sh` writes contains `RHCSA_GUEST_PASSWORD=` blank, so a bare
`. ./.env.local` assigned empty over an already-exported value, and the script
then stopped with `set RHCSA_GUEST_PASSWORD … in .env.local` — an error telling
the reader to do the thing they just did. This matters more than a normal bug
because the broken path is the **only one that keeps a live VM credential out of
a file on disk**; its failure pushes the user to persist a password they had
deliberately chosen not to. Verify the filtered `grep -vE` process substitution
skips comments, blanks **and blank-valued keys**, that an exported value survives,
that a populated key in the file is still picked up, and that the `:?` guards
below still name the missing key. The implementer measured
`RHCSA_GUEST_PASSWORD=[SECRET123]` after the fix versus `[]` before — reproduce
it rather than trusting it.

**Mandate 2 — `RHCSA_VM_IP` was never recorded.** The old guard
`! grep -q '^RHCSA_VM_IP='` was satisfied by the template's own blank
placeholder, so the branch never ran while the template's comment promised
"leave blank and it will fill this in". The consequence is not cosmetic: with no
IP, `SshTransport.isAvailable()` returns false without attempting a connection
(Task 18), so `chooseTransport` silently selects `vmrun` — three `vmrun` round
trips per `exec`, for every lab, forever, with nothing explaining why the trainer
feels slow. Check all three arms (blank → filled **in place**, populated → left
alone, absent → appended) and that `sed -i` is used rather than a second
appended copy. The `|` delimiter is safe because an IP is a dotted quad; confirm
a comment says so.

## The implementer found a defect the mandates missed — verify it, don't flag it

Mandate 3 required the step-6 IP capture wrapped in `timeout 120`. The
implementer discovered that a bare assignment `IP=$(timeout 120 … | tr -d '\r')`
**aborts the whole script** under `set -euo pipefail` when the timeout fires,
defeating mandate 3's own non-fatal intent, and restructured it as
`if IP=$(...) && [[ -n "$IP" ]] && ssh …; then`. Measured:
`IP=$(timeout 1 sleep 5 | tr -d "\r")` → `exit=124`, with the following `echo`
never reached. **This was a correct deviation and an improvement.** Verify the
`if` structure is actually there and that a timeout at step 6 falls through to
the existing "ssh did NOT work … the vmrun transport still functions" message
rather than killing the script. Do not report the deviation itself as a finding.

## Two mandates cannot be verified without a VM — say so rather than guessing

**Mandate 4 (the ISO-presence check)** rests on my reading that `vmrun`'s exit
code does not carry the guest program's — `vmrun.ts:15`'s
`GUEST_CODE_RE = /Guest program exited with non-zero code:\s*(\d+)/` exists
precisely because it reports that in prose on stdout. **I could not measure it;
no VM exists.** The fix is written to be correct under *either* behaviour by not
consulting `vmrun`'s exit code at all — the guest echoes `RHCSA_ISO_PRESENT` and
the script greps for it. Judge the fix on that property, not on whether my
reading of `vmrun` is right. If you think the token-grep can fail in some other
way, that is a legitimate finding.

**Mandate 5 (`sudo -k` before `sudo -n true`)** is guest-side and unrunnable
here. Check it by reading, against `docs/vm-build-checklist.md` §5, which already
gets this right twenty lines away in the same repo and explains why: without
`-k`, `sudo -n true` passes on the ten-second-old ticket from the `tee` the user
just authenticated, so the check cannot see the one thing it exists to catch.
Confirm `visudo -cf` still runs **ahead** of the `-k` — it is the guard against
locking `sudo` out of the machine entirely.

## Do not re-raise this — I measured it as NOT a defect

`[[ -f .env.local ]] && set -a && . ./.env.local && set +a` under `set -e`. I
expected the failed `[[ -f ]]` to abort the script when the file is absent. **It
does not** — a non-final command failing inside an `&&` list is exempt from
`set -e`. Measured: `bash -c 'set -e; [[ -f /nonexistent ]] && … ; echo
SURVIVED'` → `SURVIVED`, `rc=0`. Mandate 1 rewrites the line anyway, for an
unrelated reason. Assertion alone will not reopen this; measure it and show the
command if you disagree.

## What to check on the documentation mandates

**Mandate 6** rewrote a paragraph that misdescribed the checklist it cited. The
brief claimed the checklist "tells the user to run `guest-provision.sh` once from
the VM console"; §5 says no such thing — it has the user install the sudoers
drop-in **by hand**, then states `provision.sh` "does the rest … automatically,
so there is nothing else to run by hand." So §0 of `guest-provision.sh` is an
idempotent safety net and rebuild-recovery path, not a first-run bootstrap
requirement. Verify the new prose says that and cites §5 **by number**. A reader
debugging a failed first run must not be sent looking for an instruction that
does not exist.

**Mandate 8** stripped `README.md:19`'s `(Task 19; does not exist yet)`. It
exists now. Confirm nothing else in `README.md` moved.

**Mandate 9** added `RHCSA_VMRUN` to the template's commented overrides. I
checked all eight keys `loadVmConfig` reads (`src/engine/vm/config.ts`) against
the template and this was the only gap; `RHCSA_ISO` is read by `provision.sh`
only and never by `config.ts`, which is correct and was to get one clarifying
word. Verify the template's key set against `config.ts` yourself.

## Out of bounds

- **No VM operations, of any kind.** Do not start, stop, snapshot, revert, or
  delete a snapshot on any VM on this host — in particular not the user's Ubuntu
  or Windows 11 guests, which are unrelated to this project. **Do not run
  `provision.sh` from the repo**: if this host's `.env.local` were populated the
  guardrails would not fire and the script would proceed to `vmrun start` and a
  10 GB copy. If you want to exercise it, copy it to a scratch tree as mandate 7
  does (`provision.sh` does `cd "$(dirname "$0")/.."`, so a copy operates
  entirely inside that tree).
- **Do not create, read, or modify `/home/daxtangco/rhcsa-trainer/.env.local`.**
  It may hold the user's real VM password. It does not currently exist, per the
  implementer — do not create it. `.gitignore` line 6 covers it, so the risk here
  is reading or overwriting a live credential, not leaking it into git.
- **No `sudo` on this WSL host** — there is no TTY and it cannot authenticate.
  The `sudo` calls inside `guest-provision.sh` are guest-side and correct.
- **`shellcheck` is not installed** and was confirmed unavailable by two earlier
  tasks. Do not install it, do not chase it. "These scripts have never been
  linted" is already recorded; do not spend a finding on it.
- Do not run `subscription-manager` or handle Red Hat credentials in any form.
  Nothing in this project needs the user's Red Hat account.
- Do not propose enabling root SSH or weakening SELinux. `restorecon -R ~/.ssh`
  is load-bearing; leave it.
- **Never read or copy** `.env`, `.env.sandbox`, or `.env.example` from
  `/home/daxtangco/sechelp-tools` — an unrelated project's secrets.
- `src/`, `test/`, `content/`, `package.json` and
  `docs/vm-build-checklist.md` are out of scope for this task and were correctly
  left alone.
- Untracked or modified files belonging to a **concurrent** task may appear in
  the tree while you work — Task 20 is being implemented in
  `content/lib/assert.sh` and `test/lib/` at the same time as this review. They
  are not this task's leakage. Do not revert them, do not commit them, and judge
  only the diff you were given.

## Baseline

The branch was at **203 passing / 20 files** at `cb1a878`. This task adds no
tests and must not change that. The implementer reports 203/20 measured twice.
Run `npx vitest run` and `npm run typecheck` yourself and **report the totals you
observe** — if they differ, that discrepancy is itself the finding. Note that
Task 20 may land while you work, which would raise the total legitimately; read
`git log` before concluding anything from a mismatch.

## Report

Write the full review to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-19-review.md` and
return only: both verdicts, the findings ranked by severity, whether anything
blocks, and the totals you measured. Mark each finding **must-fix**,
**observation**, or **forward-to-later**. For anything you could not verify
without a VM, say so explicitly rather than inferring a verdict.
