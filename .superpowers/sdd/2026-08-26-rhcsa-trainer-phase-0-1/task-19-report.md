# Task 19 report — provision.sh, guest-provision.sh, .env.local template

Status: implemented, all nine mandates applied. Commit `ad8c0f2`.

## Files

- `scripts/provision.sh` (new)
- `scripts/guest-provision.sh` (new)
- `README.md` (mandate 8: stripped the "Task 19; does not exist yet" label)
- `.env.local` — **not** created, read, or modified on this host, per the
  global constraint. It does not exist here (`ls -l .env.local` → "No such
  file or directory"), so there was nothing to preserve; all testing used a
  scratch tree at `/tmp/t19` instead (mandate 7).

## Mandates applied

1. **Source line no longer wipes an exported password.** Replaced the bare
   `. ./.env.local` with a filtered process substitution that skips comments,
   blank lines, and blank-valued keys, so an already-exported
   `RHCSA_GUEST_PASSWORD` survives sourcing the template. Independently
   measured below — confirms the brief's own measurement. Added the
   `guest()`-adjacent comment about `-gp` putting the password on `vmrun`'s
   argv.
2. **`RHCSA_VM_IP` recording fixed** to key off the value being empty rather
   than the key being present, and to replace in place via `sed` rather than
   append. All three arms verified below.
3. **`getGuestIPAddress -wait` bounded with `timeout 120`** at both call
   sites (step 2's boot barrier, non-fatal either way; step 6's post-
   provisioning capture, wrapped in an `if` so a timeout there falls through
   to the existing "ssh did NOT work" message instead of killing the script
   under `set -e` — confirmed this matters by direct test, see below).
4. **ISO-presence check rewritten** to have the guest echo a token
   (`RHCSA_ISO_PRESENT`) and grep for it, rather than trusting `vmrun`'s own
   exit code. **This arm is unverified against a real `vmrun`** — no VM
   exists on this host. Step 5 (deferred) is where a second run of
   `provision.sh` printing "guest already has /var/lib/rhcsa-dvd.iso" and not
   re-copying 10 GB would confirm it.
5. **`sudo -k` added immediately before `sudo -n true`** in
   `guest-provision.sh` §0, with a comment pointing at
   `docs/vm-build-checklist.md` §5, keeping the `visudo -cf` check ahead of
   it as instructed.
6. **Bootstrap-sequencing comment rewritten.** The top-of-file comment in
   `guest-provision.sh` now says §0 is an idempotent safety net / rebuild
   recovery path (not a first-run requirement), citing checklist §5 by
   number, since §5 already states nothing else needs to be run by hand
   after the console step.
7. **Guardrail tests moved to `/tmp/t19`**, never touched the real
   `.env.local`, never invoked `vmrun`. Both runs and all three IP arms
   pasted below.
8. **README.md:19** — removed `(Task 19; does not exist yet)`.
9. **`RHCSA_VMRUN` added to the template's optional-overrides block**, with
   the default path spelled out and a note about the space needing quoting.
   Also added one clarifying line on `RHCSA_ISO` (read by this script only).

## Measurement — mandate 1 (independently confirmed, not just trusted)

```
=== broken (bare source) ===
RHCSA_GUEST_PASSWORD=[] RHCSA_SSH_USER=[student]
=== fixed (filtered process substitution) ===
RHCSA_GUEST_PASSWORD=[SECRET123] RHCSA_SSH_USER=[student]
```

Matches the brief's own measurement. Fix used as specified.

## Measurement — mandate 3's `set -e` claim (independently confirmed)

The mandate's fix for step 6 needed the IP capture wrapped in an `if`, not a
bare assignment, or a timeout there would abort the whole script instead of
falling through to the "ssh did NOT work" path. Verified directly:

```
$ bash -c '
set -euo pipefail
IP=$(timeout 1 sleep 5 | tr -d "\r")
echo "reached: IP=[$IP]"
'
echo "exit=$?"
exit=124
```

("reached" never printed — the bare assignment aborts the script under
`set -e`/`pipefail`.) This confirmed the `if IP=$(...) && [[ -n "$IP" ]] &&
ssh ...; then` structure used in the final script is required, not optional.

## Mandate 7 — scratch guardrail runs (`/tmp/t19`, no VM touched)

```
=== RUN 1: .env.local absent ===
wrote a template .env.local - fill in RHCSA_VMX and RHCSA_GUEST_PASSWORD, then re-run
/tmp/t19/scripts/provision.sh: line 55: RHCSA_VMX: set RHCSA_VMX in .env.local - see docs/vm-build-checklist.md
exit=1
=== template written ===
.rw-r--r-- 634 daxtangco 30 Aug 14:00 /tmp/t19/.env.local
# Local lab configuration. Git-ignored. Never commit this file.
#
# Only you can supply these two - see docs/vm-build-checklist.md:
RHCSA_VMX=
RHCSA_GUEST_PASSWORD=
#
# Discovered by scripts/provision.sh; leave blank and it will fill this in:
RHCSA_VM_IP=
#
# Optional overrides; the defaults are usually right:
RHCSA_SSH_USER=student
#RHCSA_SSH_PORT=22
#RHCSA_SSH_KEY=
#RHCSA_TRANSPORT=
# Path to vmrun.exe, if VMware is not in the default location. Note the space:
#RHCSA_VMRUN=/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe
# Read by this script only, never by the app itself - the DVD ISO's host path.
#RHCSA_ISO=
=== RUN 2: fill only RHCSA_VMX, re-run (guard should move to password) ===
/tmp/t19/scripts/provision.sh: line 56: RHCSA_GUEST_PASSWORD: set RHCSA_GUEST_PASSWORD (the student password) in .env.local - see docs/vm-build-checklist.md
exit=1
```

Both runs stop at a `:?` guard naming `.env.local` and
`docs/vm-build-checklist.md`, exit=1, no bash error, no `vmrun` invoked (no
"power on" log line ever printed — the script never got past the env guards).

## Mandate 2 — three arms (isolated logic test, scratch files, no VM)

The IP-recording snippet was tested in isolation against three scratch
`.env.local`-shaped files (running the full `provision.sh` end-to-end here
would require a real `vmrun` and a live VM, which does not exist and is out
of bounds — this exercises the exact logic that ships in `provision.sh`
step 6):

```
=== ARM 1: RHCSA_VM_IP blank (template state) ===
recorded RHCSA_VM_IP=192.168.100.50
RHCSA_VM_IP=192.168.100.50

=== ARM 2: RHCSA_VM_IP already populated ===
RHCSA_VM_IP already set; leaving it alone
RHCSA_VM_IP=10.0.0.9

=== ARM 3: RHCSA_VM_IP key absent entirely ===
recorded RHCSA_VM_IP=192.168.100.50 (appended)
RHCSA_VMX=/tmp/fake.vmx
RHCSA_VM_IP=192.168.100.50
```

All three match the intended behavior: blank → filled in place; already
populated → left alone; absent → appended.

## Tooling notes

- `shellcheck` is **not installed** on this host (`which shellcheck` → not
  found). Not installed, not chased, per instructions. The scripts have never
  been linted; a later pass should do so once shellcheck is available.
- `/usr/bin/timeout` **is** present (`timeout (uutils coreutils) 0.8.0`),
  confirming the mandates' assumption.
- `bash -n scripts/provision.sh && bash -n scripts/guest-provision.sh` →
  `syntax ok`.
- `chmod +x` applied to both; `ls -l scripts/` confirms
  `rwxr-xr-x` on both `provision.sh` and `guest-provision.sh`.

## Tests

`npx vitest run` — measured twice (before writing scripts, and again
immediately before committing): **20 files, 203 tests, all passing**, both
times. Unchanged, as required — this task adds no tests. (Task 18's reviewer
was running concurrently in `src/engine/vm/` and `test/vm/`; `git status
--porcelain` showed no changes there at any point I checked, so nothing of
theirs was touched or reverted.)

## Step 5 — deferred, not attempted

Per the global constraint (blocked on the VM existing; no VM operations of
any kind on this host), Step 5's acceptance was **not run**. What its four
checks would prove, once a real VM exists:

- **Check 0** (`ssh student@$IP sudo -n id -u` → `0`): the passwordless-sudo
  drop-in is actually in force, not just parsed. This is the gate — if it
  fails, nothing else is worth measuring, because every guest-side script in
  the whole project calls `sudo` on a connection with no TTY.
- **Check 1** (revert timing + post-revert state): that the `clean` snapshot
  was captured live (not powered-off), so reverts land in ~5s on a machine
  with `Enforcing` SELinux, `/var` on `/dev/mapper/rhel-var`, and non-zero
  VG free space.
- **Check 2** (`sudo dnf -y install tree` with no network): that the
  ISO-backed local repo actually works end-to-end inside the guest —
  including confirming mandate 4's fix once a real VM is available.
- **Check 3** (`df -h /home /var; sudo lvs`): that the Phase 1 lab's disk
  layout (8G `/home`, 2G `/var`, spare VG extents) survives a revert intact.

## Concerns

None beyond what's already flagged above (mandate 4's ISO-check arm is
unverified against real `vmrun`, and shellcheck was unavailable). No
out-of-scope files were touched; `git status --porcelain` is empty after the
commit and `git show --stat HEAD` lists exactly `README.md`,
`scripts/guest-provision.sh`, and `scripts/provision.sh`.
