#!/usr/bin/env bash
# "Assign physical volumes to volume groups" answered by extending the volume group
# that is already there.
#
# A real reading of a real objective: the candidate has a physical volume and a
# volume group in front of them, `vgextend` is the command that puts one into the
# other, and it works first time. What they missed is that the prompt asked for a
# NEW group with a name of its own, and that the group they extended is the one the
# running system is built on. Two checkpoints catch it - the missing group, and the
# invariant that the system group was left alone - and the second one is why
# rhel-intact is probed here rather than declared unprobed.
#
# Safe to run, and worth being explicit about why: vgextend adds a physical volume
# to the group's metadata and moves no extents onto it, so every existing logical
# volume stays exactly where it was. /home is not unmounted, the ssh channel the
# verdict travels on is untouched, and no reboot happens - reboot_check is false
# for this task. What it does leave behind on a guest that is NOT snapshot-reverted
# afterwards is a VG rhel that refers to a device which disappears at the next
# boot; `sudo vgreduce rhel <the partition>` undoes it by hand, and setup.sh's undo
# does it automatically the next time this task is staged, including the
# after-a-reboot form where the device is already gone.
# expect-fail: vg-created, rhel-intact
set -euo pipefail

dev=$(cat /run/rhcsa-lab/042-spare-device)

sudo parted -s "$dev" mklabel gpt
sudo parted -s "$dev" mkpart pvdata 1MiB 1537MiB
sudo udevadm settle
sudo pvcreate "${dev}p1"
sudo vgextend rhel "${dev}p1"
