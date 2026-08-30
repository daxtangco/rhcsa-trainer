#!/usr/bin/env bash
# Runs INSIDE the lab VM. Idempotent: safe to run repeatedly.
#
# Delivered by scripts/provision.sh. By the time this runs, the passwordless-
# sudo drop-in below already exists: docs/vm-build-checklist.md §5 has the
# user install it by hand at the console, before provision.sh (this script's
# caller) is ever invoked - and §5 says explicitly that nothing else needs to
# be run by hand after that. So §0 below is not a first-run bootstrap step;
# nobody is told to run this script at a console. It is an idempotent safety
# net, and the recovery path if the VM is ever rebuilt from `golden`, where
# the drop-in would be missing again.
set -euo pipefail

log() { printf '[guest] %s\n' "$*"; }

# --------------------------------------------------------- 0. sudo, no TTY
# Everything after this point — and every grader, setup script and solution the
# app will ever run — reaches root through sudo with no TTY to answer a prompt.
# RHEL 9's default %wheel rule asks for a password, and because our scripts
# arrive on ssh's stdin, sudo's prompt would eat the rest of the script and the
# failure would look like a broken grader. So: install the rule, validate it,
# and prove it works before continuing.
printf 'student ALL=(ALL) NOPASSWD: ALL\n' | sudo tee /etc/sudoers.d/rhcsa-trainer >/dev/null
sudo chmod 0440 /etc/sudoers.d/rhcsa-trainer
sudo visudo -cf /etc/sudoers.d/rhcsa-trainer   # a malformed drop-in can lock out sudo entirely
# sudo -k discards the cached ticket from the `tee` password above. Without
# it, `sudo -n true` would pass on that ticket regardless of whether the
# NOPASSWD rule actually took effect, which is not the thing this check is
# supposed to prove - docs/vm-build-checklist.md §5 explains this at length;
# keep this line in sync with that one.
sudo -k
sudo -n true || { echo "FATAL: passwordless sudo is not in effect for student" >&2; exit 1; }
log "passwordless sudo installed and verified"

# ---------------------------------------------------------------- ssh key
PUBKEY=${RHCSA_PUBKEY:?RHCSA_PUBKEY must be passed in}
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
chmod 600 "$HOME/.ssh/authorized_keys"
if ! grep -qxF "$PUBKEY" "$HOME/.ssh/authorized_keys"; then
  printf '%s\n' "$PUBKEY" >> "$HOME/.ssh/authorized_keys"
  log "installed trainer public key"
else
  log "trainer public key already present"
fi
# SELinux mislabels a hand-made ~/.ssh, and then sshd silently refuses the key.
# This is the single most common cause of "key installed but still prompted".
sudo restorecon -R "$HOME/.ssh"

# ------------------------------------------------------------- local repo
# An ISO-backed repo inside the VM's own disk. No subscription, no network,
# and it cannot vanish when the CD-ROM device is detached.
ISO_MNT=/var/lib/rhcsa-repo
if ! mountpoint -q "$ISO_MNT"; then
  if [[ -f /var/lib/rhcsa-dvd.iso ]]; then
    sudo mkdir -p "$ISO_MNT"
    # fstab entry makes it survive reboots, which the grader's verdict B needs.
    if ! grep -q "$ISO_MNT" /etc/fstab; then
      echo "/var/lib/rhcsa-dvd.iso $ISO_MNT iso9660 loop,ro,nofail 0 0" | sudo tee -a /etc/fstab >/dev/null
    fi
    sudo systemctl daemon-reload
    sudo mount "$ISO_MNT"
    log "mounted local DVD image at $ISO_MNT"
  else
    log "WARNING: /var/lib/rhcsa-dvd.iso is missing; skipping local repo"
  fi
fi

if mountpoint -q "$ISO_MNT"; then
  sudo tee /etc/yum.repos.d/rhcsa-local.repo >/dev/null <<EOF
[rhcsa-baseos]
name=RHCSA local BaseOS
baseurl=file://$ISO_MNT/BaseOS
enabled=1
gpgcheck=0

[rhcsa-appstream]
name=RHCSA local AppStream
baseurl=file://$ISO_MNT/AppStream
enabled=1
gpgcheck=0
EOF
  log "wrote /etc/yum.repos.d/rhcsa-local.repo"
fi

# -------------------------------------------------------------- packages
# Only what the Phase 1 tasks and the graders need. Deliberately short: every
# package pre-installed here is one the exam might expect you to install
# yourself, so this list stays minimal on purpose.
PKGS=(
  open-vm-tools   # how vmrun learns the guest IP
  policycoreutils-python-utils  # semanage, needed to *check* SELinux contexts
  libselinux-utils  # matchpathcon and getenforce, both used by graders and below
  lvm2
  xfsprogs
  e2fsprogs
  bash-completion
  vim-enhanced
  man-db
  tar
  psmisc
)
sudo dnf install -y "${PKGS[@]}"
sudo systemctl enable --now vmtoolsd

# --------------------------------------------------------------- hygiene
sudo hostnamectl set-hostname rhcsa-lab
sudo systemctl enable --now sshd

# The graders never read shell history, but a student reading their own history
# after a reset is confusing, so start each snapshot from empty.
: > "$HOME/.bash_history" || true
history -c 2>/dev/null || true

# ---------------------------------------------------------------- report
log "--- state ---"
getenforce
findmnt -no SOURCE /var
sudo vgs --noheadings -o vg_name,vg_free
sudo lvs --noheadings -o lv_name,lv_size
lsblk -no NAME,SIZE,TYPE
log "guest provisioning complete"
