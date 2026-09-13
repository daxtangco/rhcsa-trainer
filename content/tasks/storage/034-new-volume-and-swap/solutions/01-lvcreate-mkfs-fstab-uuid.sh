#!/usr/bin/env bash
# The straight-down-the-middle route: two logical volumes, two fstab entries
# written by UUID, activated by mount -a and swapon -a.
set -euo pipefail

# --- the project filesystem ------------------------------------------------
sudo lvcreate -L 4G -n projects rhel
sudo mkfs.ext4 /dev/rhel/projects
sudo mkdir -p /srv/projects

# blkid reads the UUID out of the superblock mkfs just wrote. Reading it back
# rather than inventing one is the whole point: the id belongs to the
# filesystem, so it follows the filesystem wherever the device name goes.
uuid=$(sudo blkid -s UUID -o value /dev/rhel/projects)
printf 'UUID=%s /srv/projects ext4 defaults 0 0\n' "$uuid" | sudo tee -a /etc/fstab >/dev/null

# --- the extra swap --------------------------------------------------------
sudo lvcreate -L 1G -n swapextra rhel
sudo mkswap /dev/rhel/swapextra
swap_uuid=$(sudo blkid -s UUID -o value /dev/rhel/swapextra)
printf 'UUID=%s none swap defaults 0 0\n' "$swap_uuid" | sudo tee -a /etc/fstab >/dev/null

# fstab is read by systemd's generator as well as by mount, so a reload keeps
# the two views of the file in agreement before anything is activated.
sudo systemctl daemon-reload
sudo mount -a
sudo swapon -a
