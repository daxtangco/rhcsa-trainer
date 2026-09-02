#!/usr/bin/env bash
# Configure the lab VM from WSL and capture the `clean` snapshot.
#
# Idempotent. Run it again after changing guest-provision.sh; it will re-run
# the guest part and re-capture `clean`.
#
# Never touches your Red Hat credentials. subscription-manager is not used.
set -euo pipefail

cd "$(dirname "$0")/.."

# ------------------------------------------------------------------ 0. env
# Nothing earlier in the plan can create .env.local usefully: RHCSA_VM_IP is
# discovered by provisioning, and RHCSA_VMX and RHCSA_GUEST_PASSWORD are known
# only to the user. So this is the first place with a real value to write, and
# it writes a commented template with every key present and only the discovered
# ones filled. The `:?` guards below then name exactly what is still missing.
if [[ ! -f .env.local ]]; then
  cat > .env.local <<'EOF'
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
# Values are read literally: a Windows path needs no quoting and no doubled
# backslashes. Quote only a value containing a space.
# Path to vmrun.exe, if VMware is not in the default location:
#RHCSA_VMRUN="/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe"
# Read by this script only, never by the app itself - the DVD ISO's host path.
#RHCSA_ISO=
EOF
  echo "wrote a template .env.local - fill in RHCSA_VMX and RHCSA_GUEST_PASSWORD, then re-run"
fi

# Read as data, not as shell.
#
# This used to `.` the filtered file with `set -a`, which silently corrupted the
# one value that matters most: bash treats backslashes in an unquoted assignment
# as escapes, so the RHCSA_VMX line the checklist tells the user to write,
#     RHCSA_VMX=C:\VMs\rhcsa-lab\rhcsa-lab.vmx
# arrived as `C:VMsrhcsa-labrhcsa-lab.vmx` and every vmrun call in this script
# failed on a vmx path that does not exist (measured). The app never had this
# bug - it reads the same file with node --env-file, which takes values
# literally - so the file meant two different things to its two readers. Parsing
# it the way node does makes it mean one thing, and means a Windows path needs
# no quoting or doubling here.
#
# A blank key still means "not supplied", never "supplied as empty": the
# checklist documents exporting RHCSA_GUEST_PASSWORD for a single run instead of
# writing a live VM credential to disk, and a blank template key must not wipe
# it and then blame the user for not setting it (measured: see
# task-19-report.md).
if [[ -f .env.local ]]; then
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
    [[ $line == *=* ]] || continue
    env_key=${line%%=*}
    env_val=${line#*=}
    env_key=${env_key//[[:space:]]/}
    # Anything that is not a shell name is a malformed line, not a variable.
    [[ $env_key =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    # Trim surrounding whitespace before the quote check, so `KEY = "a b"` works
    # and a stray trailing space does not end up inside a path. node --env-file
    # trims the same way; quotes are what protect an interior space.
    env_val=${env_val#"${env_val%%[![:space:]]*}"}
    env_val=${env_val%"${env_val##*[![:space:]]}"}
    [[ -n $env_val ]] || continue
    # Strip one layer of matching quotes, since the template tells the user to
    # quote a value containing a space. Unquoted values stay verbatim.
    if [[ ${#env_val} -ge 2 && $env_val == \"*\" ]]; then
      env_val=${env_val:1:${#env_val}-2}
    elif [[ ${#env_val} -ge 2 && $env_val == \'*\' ]]; then
      env_val=${env_val:1:${#env_val}-2}
    fi
    export "$env_key=$env_val"
  done < .env.local
  unset line env_key env_val
fi

: "${RHCSA_VMX:?set RHCSA_VMX in .env.local - see docs/vm-build-checklist.md}"
: "${RHCSA_GUEST_PASSWORD:?set RHCSA_GUEST_PASSWORD (the student password) in .env.local - see docs/vm-build-checklist.md}"
VMRUN=${RHCSA_VMRUN:-'/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe'}
SSH_USER=${RHCSA_SSH_USER:-student}
KEY=${RHCSA_SSH_KEY:-$HOME/.ssh/rhcsa_lab}
# The point release moves (9.6, 9.8, ...) and the checklist only tells the user
# where to put the ISO, not what to call it - so pin the location, not the
# filename. A stale filename here makes a present ISO look absent, which lands
# in step 4's silent-skip branch and leaves dnf broken in the guest.
if [[ -z ${RHCSA_ISO:-} ]]; then
  for candidate in /mnt/c/ISO/rhel-9*-x86_64-dvd.iso; do
    if [[ -f $candidate ]]; then RHCSA_ISO=$candidate; break; fi
  done
fi
ISO=${RHCSA_ISO:-/mnt/c/ISO/rhel-9-x86_64-dvd.iso}
# Accept either form for RHCSA_ISO. The checklist shows RHCSA_VMX as a Windows
# path, so a user will reasonably write one here too - and a Windows-form value
# fails the `[[ -f ]]` test in step 4 without failing the script, which is the
# worst outcome this script has: it skips the local repo and dnf is dead in the
# guest. Normalise to a WSL path so the test means what it looks like it means.
if [[ $ISO == [A-Za-z]:[\\/]* ]]; then ISO=$(wslpath -u "$ISO"); fi

log() { printf '\n[provision] %s\n' "$*"; }
# vmrun.exe is a Windows program and WSL does not translate path arguments for
# Windows programs: a WSL or relative path reaches vmrun verbatim and is not a
# path on Windows. Measured with PowerShell Test-Path - `/tmp/x/script.sh` is
# False, its `wslpath -w` form is True. Every *host* path handed to vmrun goes
# through this; guest paths must not, since the guest interprets those.
# wslpath does the conversion rather than a substitution here because only it
# knows the mount table: /mnt/c is a drive mount and becomes C:\, while /mnt/d
# on a machine with no D: drive becomes a \\wsl.localhost UNC path. Choosing
# the drive letter where one exists is also what keeps the 10 GB ISO copy off
# the 9P share. readlink -f first, so a relative path resolves before it
# converts.
hostpath() {
  if command -v wslpath >/dev/null 2>&1; then
    wslpath -w "$(readlink -f "$1")"
  else
    printf '%s\n' "$1"
  fi
}
# -gp puts RHCSA_GUEST_PASSWORD on the argv of every vmrun call below, which is
# visible in this host's process list for the duration of that call - including
# the multi-minute 10 GB copyFileFromHostToGuest at step 4. vmrun offers no
# other way to authenticate (src/engine/vm/vmrun.ts documents the same limit);
# noted here so a reader knows, not because this script can fix it.
# -gu/-gp are AUTHENTICATION-FLAGS, and `vmrun` with no arguments states the rule
# outright: "These must appear before the command and any command parameters."
# They used to sit after the vmx here, so vmrun parsed them as command
# parameters instead - it prompted for guest credentials interactively and then
# handed `-gu` to copyFileFromHostToGuest as the host path, failing with
# "The file name is not valid" (measured against real vmrun 1.17.0).
guest() { "$VMRUN" -gu "$SSH_USER" -gp "$RHCSA_GUEST_PASSWORD" "$1" "$RHCSA_VMX" "${@:2}"; }

# The only honest readiness test for the guest ops in steps 4-6: run a guest
# *program* and require its output. Everything cheaper lies.
#
# getGuestIPAddress does not test this. It answers from VMware's cached guest
# state, so on 2026-09-02 it printed "guest tools are answering" against a VM
# that Windows had suspended 95 minutes earlier (vmware.log: "PowerNotify:
# System suspend detected" at 10:29Z, this script run at 12:04Z, "System resume
# detected" 680ms *after* step 4 had already failed). Step 4's first real RPC
# then died with GuestRpcSendTimedOut, which vmrun reports as the thoroughly
# misleading "VMware Tools are not running in the guest" - Tools was running the
# whole time and reported a 5685-second collection gap once it thawed.
#
# Retrying rather than probing once is the point: a host resume takes tens of
# seconds to thaw, and there is nothing to gain from starting a 10 GB copy
# before the guest can answer.
guest_ready() {
  guest runProgramInGuest /usr/bin/bash -c 'echo RHCSA_GUEST_READY' 2>/dev/null |
    grep -q RHCSA_GUEST_READY
}
# $1 = seconds to wait. Returns non-zero on timeout rather than exiting, so the
# caller decides whether this barrier is fatal.
wait_for_guest() {
  local deadline=$((SECONDS + ${1:-300}))
  while ((SECONDS < deadline)); do
    if guest_ready; then return 0; fi
    sleep 5
  done
  return 1
}

# ------------------------------------------------------------------ 1. key
log "SSH key"
if [[ ! -f $KEY ]]; then
  mkdir -p "$(dirname "$KEY")"
  ssh-keygen -t ed25519 -N '' -C 'rhcsa-trainer' -f "$KEY"
  echo "generated $KEY"
else
  echo "reusing $KEY"
fi
PUBKEY=$(cat "$KEY.pub")

# ---------------------------------------------------------------- 2. power
log "power on"
"$VMRUN" start "$RHCSA_VMX" nogui || true
# A boot barrier, and a hard prerequisite check. This used to say that the guest
# ops below "do not need" open-vm-tools and continue on failure. That was simply
# wrong: every vmrun guest operation - copyFileFromHostToGuest, runProgramInGuest,
# deleteFileInGuest - is carried by Tools' GuestRpc channel, so steps 4, 5 and 6
# cannot run without it. Continuing anyway just moved the failure to step 4 and
# dressed it up as a file-copy problem.
echo "waiting for guest operations to answer"
if wait_for_guest 300; then
  echo "guest operations are answering"
else
  echo "guest operations did not answer within 300s." >&2
  echo "Every step below needs them, so stopping here rather than failing later" >&2
  echo "with a misleading error. Check, in this order:" >&2
  echo "  1. Is the Windows host awake? A suspended host pauses the VM, and the" >&2
  echo "     first guest op then times out as 'VMware Tools are not running'." >&2
  echo "  2. Is the guest booted to a login prompt? Check the Workstation console." >&2
  echo "  3. In the guest: systemctl is-active vmtoolsd (checklist §3.3 enables it)." >&2
  echo "  4. Is RHCSA_GUEST_PASSWORD in .env.local the current student password?" >&2
  exit 1
fi

# --------------------------------------------------------- 3. spare disks
# Deliberately none. See the design note in this task: a spare disk captured
# into `clean` carries stale partition tables into every future reset. Phase 2
# attaches them per-task with vmware-vdiskmanager.
log "spare disks: none by design (Phase 1)"

# ------------------------------------------------------------------ 4. ISO
log "local repo payload"
if [[ -f $ISO ]]; then
  # ~10 GB, so only copy it once.
  # Do not trust vmrun's exit code to carry the guest program's: it reports
  # that in prose on stdout instead (see src/engine/vm/vmrun.ts, GUEST_CODE_RE),
  # so `test -f` alone would report success merely because vmrun ran it, not
  # because the file exists. Make the guest say so instead.
  if guest runProgramInGuest /usr/bin/bash -c \
       'test -f /var/lib/rhcsa-dvd.iso && echo RHCSA_ISO_PRESENT' 2>/dev/null \
       | grep -q RHCSA_ISO_PRESENT; then
    echo "guest already has /var/lib/rhcsa-dvd.iso"
  else
    echo "copying $ISO into the guest (this takes several minutes)"
    guest copyFileFromHostToGuest "$(hostpath "$ISO")" /tmp/rhcsa-dvd.iso
    guest runProgramInGuest /usr/bin/bash -c \
      "sudo mv /tmp/rhcsa-dvd.iso /var/lib/rhcsa-dvd.iso && sudo chmod 0444 /var/lib/rhcsa-dvd.iso"
  fi
else
  echo "WARNING: $ISO not found. Set RHCSA_ISO. Skipping the local repo -"
  echo "         dnf will not work in the guest until this is fixed."
fi

# ---------------------------------------------------------------- 5. guest
log "guest provisioning"
guest copyFileFromHostToGuest "$(hostpath scripts/guest-provision.sh)" /tmp/guest-provision.sh
guest runProgramInGuest /usr/bin/bash -c \
  "RHCSA_PUBKEY='$PUBKEY' bash /tmp/guest-provision.sh"
guest deleteFileInGuest /tmp/guest-provision.sh || true

# ------------------------------------------------------------------ 6. ssh
log "SSH check"
# A failure here is meaningful, unlike step 2's boot barrier: it means guest
# tools are still not answering after provisioning finished. Bounded the same
# way and for the same reason (Task 16, docs/r1-findings.md). Capturing it as
# the condition of an `if` (rather than a bare assignment) also keeps a
# timeout here from aborting the rest of this script under `set -e` - it must
# fall through to the same "ssh did NOT work" message below as an ssh
# failure, not kill the snapshot step that follows.
if IP=$(timeout 120 "$VMRUN" getGuestIPAddress "$RHCSA_VMX" -wait 2>/dev/null | tr -d '\r') \
   && [[ -n "$IP" ]] \
   && ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
          -o UserKnownHostsFile="$HOME/.ssh/rhcsa_known_hosts" \
          -i "$KEY" "$SSH_USER@$IP" 'echo ssh-ok' 2>/dev/null | grep -q ssh-ok; then
  echo "ssh works: $SSH_USER@$IP"
  # The template ships RHCSA_VM_IP blank on purpose, but a bare
  # `grep -q '^RHCSA_VM_IP='` matches that blank line too - so keying the
  # decision on the key being *present* would mean this branch never runs
  # (measured: see task-19-report.md). Key it on the value being empty
  # instead, and replace in place rather than appending a second copy. An IP
  # is dotted-quad, so it can never contain the `|` used as sed's delimiter
  # here.
  if grep -qE '^RHCSA_VM_IP=.+' .env.local 2>/dev/null; then
    echo "RHCSA_VM_IP already set in .env.local; leaving it alone"
  elif grep -q '^RHCSA_VM_IP=' .env.local 2>/dev/null; then
    sed -i "s|^RHCSA_VM_IP=.*|RHCSA_VM_IP=$IP|" .env.local
    echo "recorded RHCSA_VM_IP=$IP in .env.local"
  else
    printf 'RHCSA_VM_IP=%s\n' "$IP" >> .env.local
    echo "recorded RHCSA_VM_IP=$IP in .env.local"
  fi
else
  echo "ssh did NOT work. The vmrun transport still functions, so this is not"
  echo "fatal. See docs/r1-findings.md for the ranked fallbacks."
fi

# ------------------------------------------------------------ 7. snapshot
log "clean snapshot"
existing=$("$VMRUN" listSnapshots "$RHCSA_VMX" | tr -d '\r')
printf '%s\n' "$existing" | sed 's/^/  /'

if printf '%s\n' "$existing" | grep -qx 'golden'; then
  echo "golden present - good, that is the fallback of last resort"
else
  echo "WARNING: no 'golden' snapshot. Create one from a powered-off state:"
  echo "  \"\$VMRUN\" stop '$RHCSA_VMX' soft && \"\$VMRUN\" snapshot '$RHCSA_VMX' golden"
fi

if printf '%s\n' "$existing" | grep -qx 'clean'; then
  echo "replacing the existing 'clean' snapshot"
  "$VMRUN" deleteSnapshot "$RHCSA_VMX" clean
fi

# Taken WHILE RUNNING, so memory is included and reverts take ~5s instead of
# a 30s+ cold boot. This is the single biggest factor in how many tasks get
# attempted per session.
"$VMRUN" snapshot "$RHCSA_VMX" clean
echo "captured 'clean' (live, memory included)"

log "done"
echo "verify a revert round-trip:"
echo "  \"\$VMRUN\" revertToSnapshot '$RHCSA_VMX' clean && \"\$VMRUN\" start '$RHCSA_VMX' nogui"
