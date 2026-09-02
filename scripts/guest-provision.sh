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

# --------------------------------------------------------- DVD-backed repo
# The RHEL DVD is attached to this VM as a CD-ROM device and mounted read-only.
# It is deliberately NOT copied into the guest, which is what this script used
# to do: the 9.8 DVD is 14.47 GiB, /var is 2 GiB, /tmp (on /) has 9.8 GiB free,
# and the volume group has 15.00 GiB free in total - so the copy could not fit
# anywhere, and making it fit would consume the entire resource the LVM tasks
# exist to exercise (all measured against the real VM, 2026-09-02). Mounting the
# attached disc costs zero guest disk and leaves VFree untouched.
#
# The device is found by *content*, not by name or label. /dev/sr0 on this VM is
# Easy Install's autoinst.iso and the DVD is /dev/sr1, but that ordering is not
# guaranteed; and the label carries the point release
# (LABEL=RHEL-9-8-0-BaseOS-x86_64), so matching on it would silently break at
# 9.9. fstab then keys on UUID, which is stable for a given ISO and
# unambiguous between the two discs.
#
# `nofail` matters: without it, a missing or moved ISO turns a routine boot into
# an emergency shell, and the VM's whole value is that it boots unattended.
DVD_MNT=/mnt/rhcsa-dvd
DVD_OK=0

find_dvd() {
  local dev probe
  probe=$(mktemp -d)
  for dev in /dev/sr*; do
    [[ -b $dev ]] || continue
    if sudo mount -o ro "$dev" "$probe" 2>/dev/null; then
      if [[ -d $probe/BaseOS/repodata && -d $probe/AppStream/repodata ]]; then
        sudo umount "$probe"
        rmdir "$probe"
        printf '%s\n' "$dev"
        return 0
      fi
      sudo umount "$probe"
    fi
  done
  rmdir "$probe"
  return 1
}

# Drop the abandoned design's fstab line before adding ours, or a reboot tries
# to loop-mount an ISO that is no longer there.
if grep -q '/var/lib/rhcsa-repo' /etc/fstab; then
  sudo sed -i '\|/var/lib/rhcsa-repo|d' /etc/fstab
  log "removed the stale /var/lib/rhcsa-repo fstab entry"
fi
if [[ -f /var/lib/rhcsa-dvd.iso ]]; then
  log "NOTE: /var/lib/rhcsa-dvd.iso is a leftover from the old copy-in design."
  log "      Nothing uses it now. Reclaim its space with: sudo rm -f /var/lib/rhcsa-dvd.iso"
fi

if mountpoint -q "$DVD_MNT" && [[ -d $DVD_MNT/BaseOS/repodata ]]; then
  log "DVD already mounted at $DVD_MNT"
  DVD_OK=1
elif DVD_DEV=$(find_dvd); then
  DVD_UUID=$(sudo blkid -o value -s UUID "$DVD_DEV")
  sudo mkdir -p "$DVD_MNT"
  # Replace any previous entry for this mountpoint rather than appending a
  # second: this script is idempotent, and the UUID changes with the release.
  sudo sed -i "\|[[:space:]]$DVD_MNT[[:space:]]|d" /etc/fstab
  printf 'UUID=%s %s iso9660 ro,nofail 0 0\n' "$DVD_UUID" "$DVD_MNT" |
    sudo tee -a /etc/fstab >/dev/null
  sudo systemctl daemon-reload
  sudo mount "$DVD_MNT"
  log "mounted $DVD_DEV (UUID=$DVD_UUID) at $DVD_MNT"
  DVD_OK=1
else
  log "WARNING: no attached disc holds BaseOS/repodata, so dnf has no repo."
  log "         Check that the RHEL DVD ISO is attached to the VM as a CD-ROM"
  log "         device and connected (vmx: sata0:1.fileName / .present)."
fi

if ((DVD_OK)); then
  # gpgcheck=1, with the key that ships on the disc. The old repo file used
  # gpgcheck=0; the exam expects a student to reason about package signing, and
  # a lab repo that skips it quietly teaches the wrong habit. The key is on the
  # DVD, so this still needs no network and no subscription.
  sudo tee /etc/yum.repos.d/rhcsa-dvd.repo >/dev/null <<EOF
[rhcsa-baseos]
name=RHEL DVD - BaseOS
baseurl=file://$DVD_MNT/BaseOS
enabled=1
gpgcheck=1
gpgkey=file://$DVD_MNT/RPM-GPG-KEY-redhat-release

[rhcsa-appstream]
name=RHEL DVD - AppStream
baseurl=file://$DVD_MNT/AppStream
enabled=1
gpgcheck=1
gpgkey=file://$DVD_MNT/RPM-GPG-KEY-redhat-release
EOF
  sudo rpm --import "$DVD_MNT/RPM-GPG-KEY-redhat-release"
  # The old repo file names a mountpoint that no longer exists. Left in place it
  # fails every dnf transaction, which would read as "the trainer broke dnf".
  sudo rm -f /etc/yum.repos.d/rhcsa-local.repo
  log "wrote /etc/yum.repos.d/rhcsa-dvd.repo (gpgcheck=1, key from disc)"
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
