#!/usr/bin/env bash
# Equally correct, and deliberately different in four ways, each of which would
# break a grader that had been fitted to solution 01:
#   - the volumes are named data and swapmore, not projects and swapextra
#   - the filesystem is identified by LABEL, not by UUID
#   - the mount is a systemd .mount unit, not an /etc/fstab line
#   - the swap carries an explicit priority
set -euo pipefail

# --- the project filesystem, labelled at mkfs time ------------------------
sudo lvcreate -L 4G -n data rhel
sudo mkfs.ext4 -L projects /dev/rhel/data
sudo mkdir -p /srv/projects

# udev builds /dev/disk/by-label/ from the superblock, so the symlink the unit
# below names does not exist until udev has processed the new filesystem.
sudo udevadm settle

# The unit file name has to be the escaped mount point (/srv/projects ->
# srv-projects.mount) or systemd refuses to load it.
sudo tee /etc/systemd/system/srv-projects.mount >/dev/null <<'UNIT'
[Unit]
Description=Analytics project storage

[Mount]
What=/dev/disk/by-label/projects
Where=/srv/projects
Type=ext4
Options=defaults

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
# enable is what makes it survive the reboot; --now is what mounts it today.
sudo systemctl enable --now srv-projects.mount

# --- the extra swap, by label and with a priority ------------------------
sudo lvcreate -L 1G -n swapmore rhel
sudo mkswap -L swapmore /dev/rhel/swapmore
printf 'LABEL=swapmore none swap pri=10 0 0\n' | sudo tee -a /etc/fstab >/dev/null
sudo systemctl daemon-reload
sudo swapon -a
