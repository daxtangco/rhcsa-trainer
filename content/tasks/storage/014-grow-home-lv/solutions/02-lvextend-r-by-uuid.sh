#!/usr/bin/env bash
# Equally correct, and deliberately different in two ways:
#   -r resizes the filesystem as part of lvextend, so no xfs_growfs runs
#   the fstab entry is re-expressed by UUID, so a grader that greps for
#   /dev/mapper/rhel-home would wrongly reject this
set -euo pipefail
sudo lvextend -r -L +4G /dev/mapper/rhel-home

uuid=$(sudo blkid -s UUID -o value /dev/mapper/rhel-home)
# The pattern requires whitespace on both sides of /home, so it cannot match
# a /home/something entry.
sudo sed -i '\|[[:space:]]/home[[:space:]]|d' /etc/fstab
printf 'UUID=%s /home xfs defaults 0 0\n' "$uuid" | sudo tee -a /etc/fstab >/dev/null
sudo systemctl daemon-reload
