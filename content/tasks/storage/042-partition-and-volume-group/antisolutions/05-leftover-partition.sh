#!/usr/bin/env bash
# Sized the first partition wrongly, then created a second one instead of deleting
# the first.
#
# This is the commonest partitioning mistake there is: 512 MiB looked like enough,
# it was not, and adding another partition is easier to think of than removing the
# one already written. The volume group ends up on a partition that is big enough,
# so everything the LVM half of this task grades is correct - and the disk is left
# with a 512 MiB orphan that nothing uses and that the prompt explicitly excluded.
# The fix is a deletion, which is the third verb in the partition objective and the
# only one no solution in this task exercises.
# expect-fail: part-single
set -euo pipefail

dev=$(cat /run/rhcsa-lab/042-spare-device)

sudo parted -s "$dev" mklabel gpt
sudo parted -s "$dev" mkpart toosmall 1MiB 513MiB
sudo parted -s "$dev" mkpart pvdata 513MiB 1537MiB
sudo udevadm settle
sudo pvcreate "${dev}p2"
sudo vgcreate vgarchive "${dev}p2"
