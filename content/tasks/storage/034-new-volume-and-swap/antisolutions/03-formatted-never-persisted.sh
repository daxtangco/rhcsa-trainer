#!/usr/bin/env bash
# The volume exists, the filesystem exists, the mount is there - and nothing
# wrote it down. `df -h` shows exactly what was asked for, so this is the answer
# that feels finished and is not.
#
# projects-persistent and projects-by-uuid are wrong immediately: there is no
# boot configuration at all, so there is also no device specification for the
# UUID requirement to be judged against. The other three only break after the
# reboot, because until then the filesystem really is mounted - and once it is
# not, /srv/projects is a directory on the root filesystem again, which is
# neither a new logical volume, nor 4 GiB, nor ext4.
# expect-fail: projects-persistent, projects-by-uuid, projects-mounted@post, projects-lv-size@post, projects-fstype@post
set -euo pipefail

sudo lvcreate -L 4G -n projects rhel
sudo mkfs.ext4 /dev/rhel/projects
sudo mkdir -p /srv/projects
sudo mount /dev/rhel/projects /srv/projects

# The swap half is written down properly, so the swap checkpoints stay green and
# this fixture probes the mount persistence alone.
sudo lvcreate -L 1G -n swapextra rhel
sudo mkswap /dev/rhel/swapextra
swap_uuid=$(sudo blkid -s UUID -o value /dev/rhel/swapextra)
printf 'UUID=%s none swap defaults 0 0\n' "$swap_uuid" | sudo tee -a /etc/fstab >/dev/null
sudo systemctl daemon-reload
sudo swapon -a
