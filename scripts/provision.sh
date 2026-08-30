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
#RHCSA_SSH_KEY="/home/user/.ssh/id_ed25519"
#RHCSA_TRANSPORT=
# Path to vmrun.exe, if VMware is not in the default location. paths with spaces must be quoted:
#RHCSA_VMRUN="/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe"
# Read by this script only, never by the app itself - the DVD ISO's host path (must be quoted):
#RHCSA_ISO="/mnt/c/ISO/rhel-9.6-x86_64-dvd.iso"
EOF
  echo "wrote a template .env.local - fill in RHCSA_VMX and RHCSA_GUEST_PASSWORD, then re-run"
fi

# Values already exported win over the file, and a blank key in the template
# means "not supplied" - never "supplied as empty". Both matter: the checklist
# documents exporting RHCSA_GUEST_PASSWORD for a single run instead of writing a
# live VM credential to disk, and sourcing a blank template key would otherwise
# wipe it and then blame the user for not setting it (measured: see
# task-19-report.md).
if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1090
  . <(grep -vE '^[[:space:]]*#|^[[:space:]]*$|=[[:space:]]*$' .env.local)
  set +a
fi

: "${RHCSA_VMX:?set RHCSA_VMX in .env.local - see docs/vm-build-checklist.md}"
: "${RHCSA_GUEST_PASSWORD:?set RHCSA_GUEST_PASSWORD (the student password) in .env.local - see docs/vm-build-checklist.md}"
VMRUN=${RHCSA_VMRUN:-'/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe'}
SSH_USER=${RHCSA_SSH_USER:-student}
KEY=${RHCSA_SSH_KEY:-$HOME/.ssh/rhcsa_lab}
ISO=${RHCSA_ISO:-/mnt/c/ISO/rhel-9.6-x86_64-dvd.iso}

log() { printf '\n[provision] %s\n' "$*"; }
# -gp puts RHCSA_GUEST_PASSWORD on the argv of every vmrun call below, which is
# visible in this host's process list for the duration of that call - including
# the multi-minute 10 GB copyFileFromHostToGuest at step 4. vmrun offers no
# other way to authenticate (src/engine/vm/vmrun.ts documents the same limit);
# noted here so a reader knows, not because this script can fix it.
guest() { "$VMRUN" "$1" "$RHCSA_VMX" -gu "$SSH_USER" -gp "$RHCSA_GUEST_PASSWORD" "${@:2}"; }

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
    guest copyFileFromHostToGuest "$ISO" /tmp/rhcsa-dvd.iso
    guest runProgramInGuest /usr/bin/bash -c \
      "sudo mv /tmp/rhcsa-dvd.iso /var/lib/rhcsa-dvd.iso && sudo chmod 0444 /var/lib/rhcsa-dvd.iso"
  fi
else
  echo "WARNING: $ISO not found. Set RHCSA_ISO. Skipping the local repo -"
  echo "         dnf will not work in the guest until this is fixed."
fi

# ---------------------------------------------------------------- 5. guest
log "guest provisioning"
guest copyFileFromHostToGuest scripts/guest-provision.sh /tmp/guest-provision.sh
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
