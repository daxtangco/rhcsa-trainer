#!/usr/bin/env bash
# The classic swap mistake: mkswap and swapon, and nothing written down. free -h
# looks right, the checklist looks done, and the swap is gone at the next boot.
#
# swap-persistent is wrong immediately. swap-added only breaks after the reboot,
# because until then the area really is active - which is exactly why one phase
# per file would not be enough to express this fixture.
# expect-fail: swap-persistent, swap-added@post
set -euo pipefail

# The mount half is done properly, by UUID, so the project checkpoints stay
# green and the swap checkpoints are the only ones under test here.
sudo lvcreate -L 4G -n projects rhel
sudo mkfs.ext4 /dev/rhel/projects
sudo mkdir -p /srv/projects
uuid=$(sudo blkid -s UUID -o value /dev/rhel/projects)
printf 'UUID=%s /srv/projects ext4 defaults 0 0\n' "$uuid" | sudo tee -a /etc/fstab >/dev/null
sudo systemctl daemon-reload
sudo mount -a

sudo lvcreate -L 1G -n swapextra rhel
sudo mkswap /dev/rhel/swapextra
sudo swapon /dev/rhel/swapextra
