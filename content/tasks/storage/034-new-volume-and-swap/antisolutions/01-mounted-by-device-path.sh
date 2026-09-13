#!/usr/bin/env bash
# Everything correct except the one thing the objective is about: the fstab
# entry names /dev/mapper/rhel-projects instead of the filesystem's UUID.
#
# It mounts today, it mounts after a reboot, and it keeps working right up to
# the day a disk is added and the device names shuffle - which is why this is
# the shape the exam objective is worded against, and why projects-by-uuid is
# graded separately from projects-persistent. Wrong in both verdicts, because
# the fstab line is just as wrong after the reboot as before it.
# expect-fail: projects-by-uuid
set -euo pipefail

sudo lvcreate -L 4G -n projects rhel
sudo mkfs.ext4 /dev/rhel/projects
sudo mkdir -p /srv/projects
printf '/dev/mapper/rhel-projects /srv/projects ext4 defaults 0 0\n' | sudo tee -a /etc/fstab >/dev/null

# The swap half is done properly, so the only checkpoint that moves is the one
# this fixture exists to probe.
sudo lvcreate -L 1G -n swapextra rhel
sudo mkswap /dev/rhel/swapextra
swap_uuid=$(sudo blkid -s UUID -o value /dev/rhel/swapextra)
printf 'UUID=%s none swap defaults 0 0\n' "$swap_uuid" | sudo tee -a /etc/fstab >/dev/null

sudo systemctl daemon-reload
sudo mount -a
sudo swapon -a
