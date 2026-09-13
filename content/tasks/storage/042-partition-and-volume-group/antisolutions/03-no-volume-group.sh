#!/usr/bin/env bash
# Stopped one layer short: the disk is labelled, the partition is there, the
# physical volume exists - and nothing was ever assigned to a volume group.
#
# This is what running out of time looks like, and it is also what happens to a
# candidate who reads `pvcreate` as "make LVM storage" and thinks the job is done
# because `pvs` now lists their partition. The physical volume sits there with an
# empty VG column and no logical volume can ever be carved from it.
#
# Four checkpoints pass here, which is the point: it isolates vg-created from
# everything below it, so a grader that inferred the group from the presence of a
# physical volume would be caught.
# expect-fail: vg-created
set -euo pipefail

dev=$(cat /run/rhcsa-lab/042-spare-device)

sudo parted -s "$dev" mklabel gpt
sudo parted -s "$dev" mkpart pvdata 1MiB 1537MiB
sudo udevadm settle
sudo pvcreate "${dev}p1"
sudo pvs "${dev}p1"
