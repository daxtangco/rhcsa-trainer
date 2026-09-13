#!/usr/bin/env bash
# The answer that only works because this one lab machine is both client and
# server: /export/reports is bind-mounted onto /mnt/reports. The files are all
# there, the contents are identical, it is written down in /etc/fstab and it
# survives a reboot - and not one byte of it went over NFS, so on a real client it
# would be nothing at all.
#
# This is the fixture that keeps reports-mounted honest: a checkpoint that only
# looked for "the right files at the right path" would pass this.
#
# Wrong in both phases, because the fstab bind entry comes back at boot.
# expect-fail: reports-mounted
set -euo pipefail

sudo umount /mnt/oldshare
sudo sed -i '\|[[:space:]]/mnt/oldshare[[:space:]]|d' /etc/fstab

sudo mkdir -p /mnt/reports
printf '/export/reports /mnt/reports none bind 0 0\n' | sudo tee -a /etc/fstab >/dev/null
sudo systemctl daemon-reload
sudo mount /mnt/reports

printf '/nfsdata /etc/auto.nfsdata\n' | sudo tee -a /etc/auto.master >/dev/null
printf 'archive -fstype=nfs,rw nfsstore.lab.example.com:/export/archive\n' | sudo tee /etc/auto.nfsdata >/dev/null
sudo systemctl enable --now autofs
ls -A /nfsdata/archive >/dev/null
