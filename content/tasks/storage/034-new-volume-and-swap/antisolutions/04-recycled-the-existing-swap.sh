#!/usr/bin/env bash
# A correct answer, plus the destructive habit the word "nondestructively" in
# the objective exists to rule out: the existing 2 GiB swap is switched off on
# the way past, because "the new one is bigger anyway".
#
# This is the fixture that keeps the invariant honest. swap-added deliberately
# measures the *additional* swap rather than the total, so it still passes here
# - the added gigabyte really is active - and old-swap-intact is the only thing
# standing between this machine and half the swap it started with. A grader that
# summed /proc/swaps instead would call this solved.
#
# @pre, not both: the original swap's own fstab entry is left alone, so the
# reboot brings it back and verdict B is clean. That is the honest declaration
# and it is also why the fixture is safe to run - the damage lasts exactly as
# long as verdict A.
# expect-fail: old-swap-intact@pre
set -euo pipefail

sudo lvcreate -L 4G -n projects rhel
sudo mkfs.ext4 /dev/rhel/projects
sudo mkdir -p /srv/projects
uuid=$(sudo blkid -s UUID -o value /dev/rhel/projects)
printf 'UUID=%s /srv/projects ext4 defaults 0 0\n' "$uuid" | sudo tee -a /etc/fstab >/dev/null

sudo lvcreate -L 1G -n swapextra rhel
sudo mkswap /dev/rhel/swapextra
swap_uuid=$(sudo blkid -s UUID -o value /dev/rhel/swapextra)
printf 'UUID=%s none swap defaults 0 0\n' "$swap_uuid" | sudo tee -a /etc/fstab >/dev/null

sudo systemctl daemon-reload
sudo mount -a
sudo swapon -a

# The mistake. swapoff moves the pages back into RAM, which on this idle guest
# is a few hundred KiB at most; the volume itself is left in place, which is
# what makes old-swap-intact's second half - "and is still active" - the only
# half that catches it.
sudo swapoff /dev/rhel/swap
