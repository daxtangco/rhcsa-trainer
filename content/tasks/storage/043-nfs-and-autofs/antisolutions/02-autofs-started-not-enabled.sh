#!/usr/bin/env bash
# Both map files are perfect and the automounter is running, so touching
# /nfsdata/archive mounts the archive exactly as asked. The service was started
# and never enabled, so all of that is gone at the next boot.
#
# autofs-enabled is wrong immediately and stays wrong. The two archive
# checkpoints pass before the reboot and fail after it, which is the regression
# the reboot check exists to catch.
# expect-fail: autofs-enabled, archive-via-autofs@post, archive-automounted@post
set -euo pipefail

sudo umount /mnt/oldshare
sudo sed -i '\|[[:space:]]/mnt/oldshare[[:space:]]|d' /etc/fstab

sudo mkdir -p /mnt/reports
printf 'nfsstore.lab.example.com:/export/reports /mnt/reports nfs defaults 0 0\n' | sudo tee -a /etc/fstab >/dev/null
sudo systemctl daemon-reload
sudo mount /mnt/reports

printf '/nfsdata /etc/auto.nfsdata\n' | sudo tee -a /etc/auto.master >/dev/null
printf 'archive -fstype=nfs,rw nfsstore.lab.example.com:/export/archive\n' | sudo tee /etc/auto.nfsdata >/dev/null
# start, not `enable --now`: today only.
sudo systemctl start autofs
ls -A /nfsdata/archive >/dev/null
