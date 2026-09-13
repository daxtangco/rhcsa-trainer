#!/usr/bin/env bash
# Right in every respect except the label type: an MBR (msdos) table where the
# prompt asked for GPT.
#
# The most likely way to arrive here is muscle memory - `fdisk` on a disk with no
# table used to leave you in DOS mode, and every older tutorial says `mklabel
# msdos`. Everything downstream works: the partition is the right size, it is a
# physical volume, the volume group is built on it, and nothing was taken from the
# system volume group. Exactly one checkpoint fails, which is what makes this the
# fixture that proves disk-gpt reads the label off the disk rather than trusting
# that a student who reached the LVM layer must have got the layer below it right.
# expect-fail: disk-gpt
set -euo pipefail

dev=$(cat /run/rhcsa-lab/042-spare-device)

sudo parted -s "$dev" mklabel msdos
sudo parted -s "$dev" mkpart primary 1MiB 1537MiB
sudo udevadm settle
sudo pvcreate "${dev}p1"
sudo vgcreate vgarchive "${dev}p1"
