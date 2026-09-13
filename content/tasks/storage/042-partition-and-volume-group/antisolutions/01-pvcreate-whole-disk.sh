#!/usr/bin/env bash
# The near-miss this task exists to catch: skip the partition table entirely and
# hand LVM the whole disk.
#
# It is not a silly mistake. LVM accepts a whole device as a physical volume, the
# volume group comes out working, `vgs` and `pvs` both look right, and a grader
# that asked "is there a physical volume, and is it in the group" would pass it -
# while the partition-table half of the objective was never touched. That is why
# pv-on-partition is a checkpoint of its own and why vg-created deliberately does
# not depend on it: here the group is genuinely fine and only the layer under it is
# wrong, and the two detail lines say so separately.
#
# The four failures, each with the reason the grader will actually print:
#
#   disk-gpt        neither reader finds a partition table. MEASURED on RHEL 9's
#                   versions: `blkid -p` on a whole-device physical volume
#                   reports TYPE=LVM2_member and no PTTYPE at all, and parted 3.5
#                   reports the label type as `unknown` - not as `loop`, which is
#                   the pseudo-label libparted uses only for the filesystems it
#                   probes itself. So this lands in the grader's '' | unknown
#                   branch, whose detail says a label or filesystem may have gone
#                   straight onto the whole device.
#   part-size       $dev has no partitions.
#   part-single     the same, from the other checkpoint's sentence.
#   pv-on-partition the physical volume is the whole disk, named as such.
#
# vg-created passes, and that is the point: the group is genuinely fine.
# expect-fail: disk-gpt, part-size, part-single, pv-on-partition
set -euo pipefail

dev=$(cat /run/rhcsa-lab/042-spare-device)

sudo pvcreate "$dev"
sudo vgcreate vgarchive "$dev"
