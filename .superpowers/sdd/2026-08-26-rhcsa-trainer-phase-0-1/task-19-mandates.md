# Task 19 — mandated changes to the brief

Nine **required** changes. They override `task-19-brief.md` wherever they
conflict; everything else in the brief stands, including its package list, its
design notes on spare disks and the live snapshot, and its commit message.

**Read the measurement warning first.** Every claim below rests on a command I
ran on this machine and pasted verbatim, or on a file in this repo I quote by
line. Six times in this project I have handed an implementer a confident
measurement; once it was wrong. So: **confirm anything you depend on with your
own command. If your measurement disagrees with mine, yours wins — say so in the
report and act on yours.**

This task is **blocked on the VM existing**, so its acceptance step is deferred
and most of it cannot be run. That makes the reading defects below the whole of
what this review can catch, and it makes them matter more than usual: nobody will
find them by running the script until the day the user runs it for real, on the
one path where a wrong turn costs them a rebuilt VM.

## Measured facts these mandates rest on

Run on this host:

```
=== does sourcing a blank template clobber an exported password? ===
after sourcing, RHCSA_GUEST_PASSWORD=[]
CONFIRMED: exported password was WIPED by the blank template line

=== does the RHCSA_VM_IP guard ever let the IP be recorded? ===
CONFIRMED: guard matched the blank template line -> IP never recorded

=== proposed fix: skip empty-valued assignments when sourcing ===
with fix, RHCSA_GUEST_PASSWORD=[SECRET-FROM-READ-PROMPT]  RHCSA_SSH_USER=[student]
```

`/usr/bin/timeout` exists. `.env.local` **is** already in `.gitignore` (line 6),
so the template the script writes cannot be committed by accident — verified, and
recorded here so nobody re-raises it.

### One thing I suspected and measured as NOT a defect — do not "fix" it

`[[ -f .env.local ]] && set -a && . ./.env.local && set +a` under `set -e`. I
expected the failed `[[ -f ]]` to abort the script when the file is absent.
It does not: a non-final command failing inside an `&&` list is exempt from
`set -e`. Measured with `bash -c 'set -e; [[ -f /nonexistent ]] && … ; echo
SURVIVED'` → `SURVIVED`, `rc=0`. The line is safe as written (and mandate 1
rewrites it anyway, for an unrelated reason).

## 1. Sourcing the template destroys an exported password — and that is the only path that keeps the credential off disk

```bash
[[ -f .env.local ]] && set -a && . ./.env.local && set +a
: "${RHCSA_GUEST_PASSWORD:?set RHCSA_GUEST_PASSWORD (the student password) in .env.local …}"
```

The template this same script writes contains `RHCSA_GUEST_PASSWORD=` with an
empty value. Sourcing it therefore **assigns empty over anything already in the
environment** — measured above. So Step 5's own documented invocation:

```bash
read -rsp 'student password: ' RHCSA_GUEST_PASSWORD && export RHCSA_GUEST_PASSWORD
bash scripts/provision.sh
```

types the password, exports it, has it silently wiped, and then stops with
`set RHCSA_GUEST_PASSWORD … in .env.local` — an error instructing the reader to
do the thing they just did. This is the third instance of that exact shape in this
plan (Task 17 mandate 9, Task 18 mandate 6), and this one is the worst of the
three, because the broken path is the only one that keeps a live VM credential
**out of a file on disk**. Its failure pushes the user to persist a password they
had deliberately chosen not to persist.

Replace the source line so that **a value already in the environment wins, and a
blank key in the template means "not supplied" rather than "supplied as empty"**:

```bash
# Values already exported win over the file, and a blank key in the template
# means "not supplied" - never "supplied as empty". Both matter: the checklist
# documents exporting RHCSA_GUEST_PASSWORD for a single run instead of writing a
# live VM credential to disk, and sourcing a blank template key would otherwise
# wipe it and then blame the user for not setting it.
if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1090
  . <(grep -vE '^[[:space:]]*#|^[[:space:]]*$|=[[:space:]]*$' .env.local)
  set +a
fi
```

Measured above: this preserves an exported `RHCSA_GUEST_PASSWORD` while still
picking up `RHCSA_SSH_USER=student` from the file. The `:?` guards below it keep
working unchanged and still name the missing key.

Add one further comment where `guest()` is defined, stating that
`-gp "$RHCSA_GUEST_PASSWORD"` puts the password on the argv of every `vmrun`
call — visible in the host process list for the duration, and that duration
includes a multi-minute 10 GB `copyFileFromHostToGuest`. `vmrun` offers no other
way to authenticate (Task 17 established this and says so in `vmrun.ts`); the
point is that a reader should know, not that this script can fix it.

## 2. `RHCSA_VM_IP` is never recorded, and the template promises it will be

```bash
if ! grep -q '^RHCSA_VM_IP=' .env.local 2>/dev/null; then
  echo "RHCSA_VM_IP=$IP" >> .env.local
```

The template written 60 lines earlier contains the line `RHCSA_VM_IP=`, which
`^RHCSA_VM_IP=` matches. So the guard is satisfied by the placeholder, the branch
never runs, and the IP is never written — **measured and confirmed above**. The
template's own comment says:

```
# Discovered by scripts/provision.sh; leave blank and it will fill this in:
RHCSA_VM_IP=
```

It will not. The comment is a promise the code cannot keep, which is this
project's recurring defect in its documentation form: *an instruction that states
an action without stating that what the reader will see is something else.*

The consequence is not cosmetic. `SshTransport.isAvailable()` returns `false`
with no IP and without attempting a connection (Task 18), so `chooseTransport`
silently selects `vmrun` — three `vmrun` round trips per `exec`, for every lab,
forever, with nothing anywhere explaining why the trainer feels slow. Task 18
mandate 7 documents that same silent downgrade from the other end.

Fix by **replacing the value in place rather than appending**, and key the
decision on the value being empty rather than the key being present:

```bash
if grep -qE '^RHCSA_VM_IP=.+' .env.local 2>/dev/null; then
  echo "RHCSA_VM_IP already set in .env.local; leaving it alone"
elif grep -q '^RHCSA_VM_IP=' .env.local 2>/dev/null; then
  # The template ships this key blank on purpose; fill it, do not append a
  # second copy.
  sed -i "s|^RHCSA_VM_IP=.*|RHCSA_VM_IP=$IP|" .env.local
  echo "recorded RHCSA_VM_IP=$IP in .env.local"
else
  printf 'RHCSA_VM_IP=%s\n' "$IP" >> .env.local
  echo "recorded RHCSA_VM_IP=$IP in .env.local"
fi
```

Verify all three arms with a scratch `.env.local` per mandate 7 — blank key,
already-populated key, key absent entirely — and paste the results. An IP is
dotted-quad so it cannot contain a `|`, which is why that `sed` delimiter is
safe; say so in a comment.

## 3. `getGuestIPAddress -wait` can hang forever on the very first run

```bash
"$VMRUN" start "$RHCSA_VMX" nogui || true
"$VMRUN" getGuestIPAddress "$RHCSA_VMX" -wait
```

`getGuestIPAddress` needs `open-vm-tools` running in the guest to answer. Task 16
measured that against a guest without it, that exact call **hangs indefinitely** —
it had to be killed after several minutes (`docs/r1-findings.md`). And
`open-vm-tools` is installed by `guest-provision.sh` further down this very
script, in its `PKGS` list — so it is explicitly not assumed present.

That is a bootstrap deadlock on run 1: the script that installs the tools waits
for the tools first. With `-wait` and no ceiling, the user's first experience of
`provision.sh` is an unkillable-looking hang with no output, at a step whose
result **is discarded** — nothing captures this call's stdout; it is only a
"wait for the guest to finish booting" barrier.

Bound it, and make failing non-fatal:

```bash
# Only a boot barrier - the IP is captured later, after open-vm-tools exists.
# A fresh VM has no open-vm-tools yet (guest-provision.sh installs it below),
# and getGuestIPAddress -wait against a guest without it hangs indefinitely
# rather than failing: measured in Task 16, see docs/r1-findings.md. So bound
# it and carry on; vmrun's guest ops do not need the IP.
if timeout 120 "$VMRUN" getGuestIPAddress "$RHCSA_VMX" -wait >/dev/null 2>&1; then
  echo "guest tools are answering"
else
  echo "guest tools did not answer within 120s - expected on a first run, before"
  echo "open-vm-tools is installed. Continuing; the guest ops below do not need it."
fi
```

Wrap the **later** capture at step 6 in `timeout 120` as well. There, a failure
*is* meaningful — it means the tools still are not answering after provisioning —
so print that distinction rather than reusing the reassuring first-run wording,
and let the existing "ssh did NOT work … the vmrun transport still functions"
path handle it. Do not add a retry loop.

`/usr/bin/timeout` is present on this host; I checked.

## 4. The ISO-presence check cannot detect the ISO

```bash
if guest runProgramInGuest /usr/bin/test -f /var/lib/rhcsa-dvd.iso 2>/dev/null; then
  echo "guest already has /var/lib/rhcsa-dvd.iso"
else
  … copy 10 GB …
fi
```

This relies on `vmrun`'s **own** exit code reflecting the guest program's exit
code. Task 17's `vmrun.ts:15` — written from this same plan — says otherwise:

```ts
/** vmrun reports the guest program's exit status in prose on stdout. */
const GUEST_CODE_RE = /Guest program exited with non-zero code:\s*(\d+)/
```

That regex exists precisely because `vmrun`'s exit status does not carry the
guest's. If `vmrun` exits 0 whenever it *successfully ran* a program, this `if`
is always true, the copy never happens, and the failure surfaces three steps
later as `guest-provision.sh` dying at `sudo dnf install` under `set -e` — after
it has already printed `WARNING: /var/lib/rhcsa-dvd.iso is missing`. The visible
symptom is a `dnf` error; the cause is a check that passed for the wrong reason.

**I could not measure this: it needs a VM, and no VM exists.** So do not take my
reading of it as settled. What the fix must do is be correct under *either*
behaviour, by not consulting `vmrun`'s exit code at all — have the guest print a
token and grep for it:

```bash
# Do not trust vmrun's exit code to carry the guest program's: it reports that
# in prose on stdout instead (see src/engine/vm/vmrun.ts:15), so `test -f`
# alone would report success merely because vmrun ran it. Make the guest say so.
if guest runProgramInGuest /usr/bin/bash -c \
     'test -f /var/lib/rhcsa-dvd.iso && echo RHCSA_ISO_PRESENT' 2>/dev/null \
     | grep -q RHCSA_ISO_PRESENT; then
```

State in your report that this arm is unverified against a real `vmrun` and that
Step 5 is where it gets confirmed — specifically, that a second run of
`provision.sh` must print `guest already has /var/lib/rhcsa-dvd.iso` and must not
re-copy 10 GB.

## 5. `guest-provision.sh` §0 proves nothing, and this repo already explains why

```bash
printf 'student ALL=(ALL) NOPASSWD: ALL\n' | sudo tee /etc/sudoers.d/rhcsa-trainer >/dev/null
sudo chmod 0440 /etc/sudoers.d/rhcsa-trainer
sudo visudo -cf /etc/sudoers.d/rhcsa-trainer
sudo -n true || { echo "FATAL: passwordless sudo is not in effect for student" >&2; exit 1; }
```

On a first console run the user has just authenticated to `sudo` for the `tee`,
so `sudo` holds a per-TTY timestamp ticket (15 minutes by default). `sudo -n true`
then succeeds **on that ticket**, whether or not the drop-in took effect. The
check passes for the wrong reason, and the one thing it exists to catch — a
drop-in that parsed but is not in force — is exactly what it cannot see.

`docs/vm-build-checklist.md` §5 already gets this right and explains it at
length, twenty lines away in the same repository:

```bash
sudo -k && sudo -n true && echo "passwordless sudo is in effect"
```

> `sudo -k` throws away the cached credential from the password you just typed
> for the `tee` command above — without it, `sudo -n true` would pass on that
> ten-second-old ticket regardless of whether the NOPASSWD rule actually took
> effect, which is not the thing this check is supposed to prove.

Make `guest-provision.sh` match: `sudo -k` immediately before the `sudo -n true`,
and a comment pointing at checklist §5 so the two cannot drift apart again. Keep
the `visudo -cf` check exactly where it is — it is the guard against locking
`sudo` out of the machine entirely, and it must stay ahead of the `-k`.

## 6. The bootstrap-sequencing paragraph misdescribes the checklist it cites

The brief says, below `guest-provision.sh`:

> This script's *own* `sudo` calls still need a password the first time, because
> the drop-in it installs does not exist yet. That is why Task 15's checklist
> tells the user to run it once from the VM console, where a password prompt is
> answerable.

The checklist does not say that. §5 has the user install the drop-in **by hand**
at the console, and then states: *"`scripts/provision.sh` (Task 19) does the rest
of the guest configuration — the ssh key, the local repo, the packages —
automatically, so there is nothing else to run by hand."* §3 likewise says
`provision.sh` "does not need you to write it down."

So the drop-in already exists before `guest-provision.sh` ever runs, and nobody
is told to run `guest-provision.sh` at a console — the script's §0 is an
idempotent safety net (and the recovery path for a rebuilt VM), not a
first-run bootstrap requirement. Rewrite the paragraph to say that, and cite
checklist §5 by number. A reader debugging a failed first run should not be sent
looking for an instruction that does not exist.

## 7. Step 4 can power on a VM and copy 10 GB — run it in a scratch directory

Step 4 says "Verify the guardrails fire without a VM" and has you run
`bash scripts/provision.sh` in the repo. **The guardrails only fire when the
values are missing.** Checklist §6 tells the user to fill `RHCSA_VMX` and
`RHCSA_GUEST_PASSWORD` into `.env.local` — so if this host's `.env.local` is
already populated, the script sails past both `:?` guards and proceeds to
`ssh-keygen`, `vmrun start`, and a multi-minute 10 GB copy into a VM. That
violates this task's own out-of-bounds rule, unattended.

`provision.sh` does `cd "$(dirname "$0")/.."`, so a copy of the script placed in
a scratch tree operates entirely inside that tree:

```bash
rm -rf /tmp/t19 && mkdir -p /tmp/t19/scripts
cp scripts/provision.sh /tmp/t19/scripts/
bash /tmp/t19/scripts/provision.sh; echo "exit=$?"     # .env.local absent
ls -l /tmp/t19/.env.local
# then fill in only RHCSA_VMX and re-run, to see the guard move to the password:
sed -i 's|^RHCSA_VMX=|RHCSA_VMX=/tmp/fake.vmx|' /tmp/t19/.env.local
bash /tmp/t19/scripts/provision.sh; echo "exit=$?"
```

Both runs must stop at a `:?` guard naming `.env.local` and
`docs/vm-build-checklist.md` — not a bash error, and with no `vmrun` invoked.
Paste both. Then use the same scratch tree for mandate 2's three arms.

**Do not create, read, or modify `/home/daxtangco/rhcsa-trainer/.env.local`.**
It may already hold the user's real VM password. `.gitignore` line 6 covers it, so
the template is not a commit risk — the risk here is reading or overwriting a live
credential, not leaking it into git.

**Do not run Step 5, and do not run any VM operation.** Do not start, stop,
snapshot, revert, or delete a snapshot on any VM on this host — in particular not
the user's Ubuntu or Windows 11 guests, which are unrelated to this project. In
your report, mark Step 5 deferred and state what each of its four checks will
prove; check 0 (`sudo -n id -u` printing `0`) is the gate that everything else
depends on.

## 8. Strip the README's placeholder label

`README.md:19` reads:

```
3. Configure it: `bash scripts/provision.sh` (Task 19; does not exist yet).
```

It exists as of this task. Remove the parenthetical, exactly as Task 16 did for
step 2. This is a parked item from an earlier task's review, forwarded here
because this is the task that makes the label false. Change nothing else in
`README.md`, and add `README.md` to the `git add` in Step 6.

## 9. The template omits `RHCSA_VMRUN`, which two readers already consult

Minor, but it is a documentation gap with a real consequence. The template's
"optional overrides" block lists `RHCSA_SSH_USER`, `RHCSA_SSH_PORT`,
`RHCSA_SSH_KEY`, `RHCSA_TRANSPORT`, and `RHCSA_ISO` — and not `RHCSA_VMRUN`. But
`provision.sh` itself reads `${RHCSA_VMRUN:-…}`, and so does
`loadVmConfig` (`src/engine/vm/config.ts:52`). So a user whose VMware Workstation
is not at the default path has no discoverable way to learn that the key exists;
they would have to read the script to find it.

I checked all nine keys against `loadVmConfig` and the rest match exactly —
`RHCSA_VMX`, `RHCSA_GUEST_PASSWORD`, `RHCSA_VM_IP`, `RHCSA_SSH_USER`,
`RHCSA_SSH_PORT`, `RHCSA_SSH_KEY`, `RHCSA_TRANSPORT` — so this is the only gap.
(`RHCSA_ISO` is read by this script only, never by `config.ts`; that asymmetry is
correct and worth one clarifying word in the template.)

Add to the overrides block, commented out like its neighbours, with the default
spelled out so the reader knows the shape and that the space needs quoting:

```
# Path to vmrun.exe, if VMware is not in the default location. Note the space:
#RHCSA_VMRUN=/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe
```

Keep every other template key exactly as the brief writes it, including the blank
`RHCSA_VM_IP` that mandate 2 now fills in.

## Out of scope

- Do not touch `src/`, `test/`, `content/`, or `package.json`. This task is
  shell scripts and one README line.
- Do not modify `docs/vm-build-checklist.md`. Mandate 5 makes the guest script
  agree with it; the checklist itself is correct and Task 15 is closed.
- Do not add spare disks, and do not run `subscription-manager` or handle Red Hat
  credentials in any form. The user's Red Hat account is theirs; nothing in this
  project needs it.
- Do not enable root SSH, and do not weaken SELinux. `restorecon -R ~/.ssh` stays;
  it is load-bearing, and the brief's comment about it is correct.
- No `sudo` **on this WSL host** — there is no TTY and it cannot authenticate.
  The `sudo` calls inside `guest-provision.sh` are guest-side and correct.
- Never read or copy `.env`, `.env.sandbox`, or `.env.example` from
  `/home/daxtangco/sechelp-tools` — an unrelated project's secrets.
- Do not dispatch subagents.

## Verify before committing

1. `bash -n scripts/provision.sh && bash -n scripts/guest-provision.sh` clean.
2. `chmod +x` both, and confirm the mode landed (`ls -l scripts/`).
3. **`shellcheck` is not installed on this host** — Task 16's reviewer confirmed
   it is not on `PATH`. Do not install it and do not chase it; note in your
   report that it was unavailable, so a later pass knows the scripts have never
   been linted.
4. Mandate 7's two scratch runs, pasted. Mandate 2's three arms, pasted.
5. `npx vitest run` — must still be whatever the branch is at when you start
   (Task 18 changes it; read `git log` and measure, do not assume). This task
   adds no tests and must not change that number.
6. `git status --porcelain` empty after committing, and `git show --stat HEAD`
   listing exactly `scripts/provision.sh`, `scripts/guest-provision.sh`, and
   `README.md` — **no `.env.local`.**

Report to `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-19-report.md`
as a real file. Include the pasted scratch runs, the observed test total, the note
that `shellcheck` was unavailable, and — for mandate 4 — an explicit statement
that the ISO-presence arm is unverified against a real `vmrun`.
