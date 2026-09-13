#!/usr/bin/env bash
# The leftover share was unmounted and its fstab line was left alone, so it is
# gone until the machine reboots and then it is back. The mirror image of
# anti-solution 01, and the reason "not mounted" is only half of what
# oldshare-released asks.
#
# Wrong in both phases: before the reboot because the entry is still there, after
# it because the entry did what entries do.
# expect-fail: oldshare-released
set -euo pipefail

sudo umount /mnt/oldshare

sudo mkdir -p /mnt/reports
printf 'nfsstore.lab.example.com:/export/reports /mnt/reports nfs defaults 0 0\n' | sudo tee -a /etc/fstab >/dev/null
sudo systemctl daemon-reload
sudo mount /mnt/reports

printf '/nfsdata /etc/auto.nfsdata\n' | sudo tee -a /etc/auto.master >/dev/null
printf 'archive -fstype=nfs,rw nfsstore.lab.example.com:/export/archive\n' | sudo tee /etc/auto.nfsdata >/dev/null
sudo systemctl enable --now autofs
ls -A /nfsdata/archive >/dev/null
