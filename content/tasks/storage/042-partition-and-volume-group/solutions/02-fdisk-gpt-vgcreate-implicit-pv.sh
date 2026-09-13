#!/usr/bin/env bash
# Equally correct, and deliberately different in three ways rather than one:
#
#   - fdisk writes the GPT label and the partition, not parted. Different tool,
#     different code path, and the one the exam objectives' wording ("list, create
#     and delete partitions") is usually taught with.
#   - the partition is sized by LENGTH (+1200M) instead of by an END offset
#     (1MiB..1537MiB). That is the same difference as `-L +4G` versus `-L 4G` one
#     layer up, and it is where solutions/01's odd-looking 1537 comes from.
#   - there is no pvcreate at all. vgcreate initialises a physical volume on a
#     device that is not one yet, so a grader that insisted on watching pvcreate
#     run, or that required the partition to have been a physical volume before
#     the group existed, would reject this perfectly good answer.
#
# It also sets no partition type code, where a candidate following the book would
# press `t` and choose "Linux LVM" - number 30 in the GPT type list of the fdisk
# RHEL 9 ships (util-linux 2.37.4, measured; 31 there is "Linux variable data",
# and the numbering shifts between util-linux releases, which is why `L` lists
# them rather than anyone memorising the digits). Leaving it unset is on purpose:
# the type code on a GPT partition is advisory, LVM neither sets nor requires it,
# and a grader that read it would fail both of these solutions and pass an answer
# that labelled an empty partition.
set -euo pipefail

dev=$(cat /run/rhcsa-lab/042-spare-device)

# fdisk driven from a pipe, one answer per line:
#   g        create a new empty GPT partition table
#   n        add a partition
#   (empty)  accept the default partition number, 1
#   (empty)  accept the default first sector, where fdisk aligns it for us
#   +1200M   make it 1200 MiB long
#   w        write the table out and ask the kernel to re-read it
printf '%s\n' g n '' '' +1200M w | sudo fdisk "$dev"
sudo udevadm settle

sudo vgcreate vgarchive "${dev}p1"
sudo pvs "${dev}p1"
