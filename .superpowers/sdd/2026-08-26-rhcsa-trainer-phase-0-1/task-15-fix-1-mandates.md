# Task 15 — fix round 1

Two edits, both documentation. F2 needs no action on the committed files.

## F1 — `README.md` steps 2 and 3 name scripts that do not exist, unlabelled

Steps 2 and 3 tell the reader to run `bash scripts/r1-probe.sh` and
`bash scripts/provision.sh`. Neither file exists; a reader following the list in
order gets `bash: scripts/r1-probe.sh: No such file or directory`, exit 127, with
nothing saying that is expected. Step 4 already carries that disclosure because
mandate 5 required it — mandate 5 only covered step 4 because step 4 was the only
one I checked.

Label both, in the same spirit as step 4: name the owning task and say the script
does not exist yet. Task 16 owns `scripts/r1-probe.sh`; Task 19 owns
`scripts/provision.sh`. Keep it to a clause or a short sentence each — the README
is 24 lines and should stay close to that. Do not add a "project status" section,
a phase table, or a roadmap.

## F2 — no action

The report says "exactly four hunks" and then lists three locations. Three is
correct; the localization is right. Do not edit the report and do not re-diff.
Recorded as an observation only.

## F3 + F4 — `docs/vm-build-checklist.md` §3 step 5 asks for something the reader cannot do

This is the substantive one, and it is two defects in one paragraph. The current
text (lines 150–155) is:

> Run `scripts/guest-provision.sh` (Task 19) **from the VM console, not over
> ssh**; it will ask for `student`'s password once and never again. Its first act
> is to install `/etc/sudoers.d/rhcsa-trainer`, and after that every `sudo` in
> the guest — including every grader, setup script and solution the app runs —
> needs no password. The console is the only place that first prompt can be
> answered, which is why this step is not automated.

**F3 (found by the reviewer).** `scripts/guest-provision.sh` runs `set -euo
pipefail` and, immediately after the sudoers section, hits
`PUBKEY=${RHCSA_PUBKEY:?RHCSA_PUBKEY must be passed in}`. `RHCSA_PUBKEY` is only
ever supplied by `provision.sh` when *it* drives the guest script over `vmrun`. So
a reader running it by hand at the console types the password, watches the sudoers
rule install, and then the script dies with an unfamiliar env-var error and a
non-zero exit. Functionally harmless — it is idempotent and `provision.sh`
finishes the rest later — but a reader told the script would "never [prompt]
again" and then handed a hard error has every reason to think the build is broken.

**F4 (found by me, on top of F3).** There is no way for the reader to run that
script at all. It lives in the WSL repo. Nothing in §1–§3 clones the repo into the
guest, copies the file in, or mounts anything from the host — and the guest has no
network path to the repo either. §3 step 5 names a file that is not on the machine
the reader is sitting at, and gives no way to put it there. F3 describes what
happens after an impossible prerequisite.

**Fix both by inlining the work instead of naming the script.** The only thing
that genuinely must happen at the console is installing the sudoers drop-in, and
that is three commands the reader can type. Replace step 5 with the commands
themselves, taken verbatim from section 0 of `guest-provision.sh` as quoted in
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-19-brief.md` (read it;
do not retype from memory):

```bash
printf 'student ALL=(ALL) NOPASSWD: ALL\n' | sudo tee /etc/sudoers.d/rhcsa-trainer >/dev/null
sudo chmod 0440 /etc/sudoers.d/rhcsa-trainer
sudo visudo -cf /etc/sudoers.d/rhcsa-trainer
sudo -n true && echo "passwordless sudo is in effect"
```

Keep, in your own prose around it:

- that this is the one step that must happen **at the console, not over ssh**, and
  why: `sudo` will prompt for `student`'s password here and the console is the
  only place that prompt can be answered.
- what it buys: after this, every `sudo` in the guest — every grader, setup
  script, solution and anti-solution the app runs — needs no password. Say that
  nothing in the project works without it.
- **the `visudo -cf` check is not decoration.** A malformed drop-in can lock
  `sudo` out of the machine entirely. If it does not print `parsed OK`, say to fix
  or remove the file before logging out of the console — that is the last moment
  it can be fixed without `golden`.
- that `sudo -n true` printing the success line is the proof, and that
  `provision.sh` (Task 19) does the rest of the guest configuration — ssh key,
  local repo, packages — automatically, so there is nothing else to run by hand
  here.

Do **not** tell the reader to run `guest-provision.sh` by hand and expect an
error. Documenting a spurious failure as expected is worse than removing the
instruction that causes it.

## Scope

- These two files only: `README.md` and `docs/vm-build-checklist.md` §3 step 5.
- **This §3 step 5 rewrite is an authorized fourth divergence from the brief's
  fenced block.** The other three (§1 step 7, §3 step 4, §6) stay exactly as
  committed. Everything else in the checklist stays byte-identical to the brief —
  in particular do not touch the "Why these settings" table, the partition table,
  the `findmnt /var` hard stop, or the `getenforce` line. **SELinux stays
  `enforcing`.**
- No tests. No `src/`, `test/`, `content/`, `scripts/`, `package.json`.
- Do not create `.env.local`. Do not start VMware, boot a VM, or download the ISO.
- Never read or copy `.env`, `.env.sandbox`, or `.env.example` from
  `/home/daxtangco/sechelp-tools` — an unrelated project's secrets.

## Verify before committing

1. Re-diff against the brief and confirm **exactly four** hunks now, at §1 step 7,
   §3 step 4, §3 step 5, §6:
   `awk 'NR>=20 && NR<=222' .superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-15-brief.md > /tmp/b.md && diff -u /tmp/b.md docs/vm-build-checklist.md | grep -c '^@@'`
2. `bash -n` the new fenced block's contents is not applicable (it is guest-side),
   but confirm by eye that the four commands match `task-19-brief.md`'s section 0
   character for character apart from the last line's added `&& echo`.
3. Read the README start to finish as a reader who has just cloned this repo, and
   confirm every one of the four steps says either "run this" or "this does not
   exist yet, Task N makes it".
4. `git status --porcelain` empty after committing.

Commit message: `docs: label unbuilt scripts in README, inline the console sudo step`
