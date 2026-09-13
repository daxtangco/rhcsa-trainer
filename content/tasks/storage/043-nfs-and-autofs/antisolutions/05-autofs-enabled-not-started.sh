#!/usr/bin/env bash
# The other half of anti-solution 02's mistake: the maps are right and the service
# was enabled without `--now`, so it will be running tomorrow and is not running
# today. "I configured it, so it works" is the belief being punctured here.
#
# This fixture also pins down two grader properties that would otherwise be free
# to drift. autofs-enabled must NOT secretly require the service to be running -
# it passes here in both phases. And the two archive checkpoints must be measuring
# live mount state rather than the contents of the map files, which is why they
# are the only things that fail, and only before the reboot: booting starts the
# service the enable asked for, and everything comes right on its own.
# expect-fail: archive-via-autofs@pre, archive-automounted@pre
set -euo pipefail

sudo umount /mnt/oldshare
sudo sed -i '\|[[:space:]]/mnt/oldshare[[:space:]]|d' /etc/fstab

sudo mkdir -p /mnt/reports
printf 'nfsstore.lab.example.com:/export/reports /mnt/reports nfs defaults 0 0\n' | sudo tee -a /etc/fstab >/dev/null
sudo systemctl daemon-reload
sudo mount /mnt/reports

printf '/nfsdata /etc/auto.nfsdata\n' | sudo tee -a /etc/auto.master >/dev/null
printf 'archive -fstype=nfs,rw nfsstore.lab.example.com:/export/archive\n' | sudo tee /etc/auto.nfsdata >/dev/null
# enable without --now: tomorrow only.
sudo systemctl enable autofs
