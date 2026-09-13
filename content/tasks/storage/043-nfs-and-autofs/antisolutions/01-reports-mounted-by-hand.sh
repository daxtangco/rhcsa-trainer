#!/usr/bin/env bash
# The most common wrong answer in the whole objective: the share is mounted, it
# works, `ls` shows the files, and nothing was written down. Everything else in
# this fixture is correct, so the only thing being measured is persistence.
#
# reports-persistent is wrong immediately. reports-mounted only breaks after the
# reboot, because until then the share really is mounted - which is exactly why
# one phase per declaration is not enough to express this shape.
# expect-fail: reports-persistent, reports-mounted@post
set -euo pipefail

sudo umount /mnt/oldshare
sudo sed -i '\|[[:space:]]/mnt/oldshare[[:space:]]|d' /etc/fstab

sudo mkdir -p /mnt/reports
sudo mount -t nfs nfsstore.lab.example.com:/export/reports /mnt/reports

printf '/nfsdata /etc/auto.nfsdata\n' | sudo tee -a /etc/auto.master >/dev/null
printf 'archive -fstype=nfs,rw nfsstore.lab.example.com:/export/archive\n' | sudo tee /etc/auto.nfsdata >/dev/null
sudo systemctl enable --now autofs
ls -A /nfsdata/archive >/dev/null
