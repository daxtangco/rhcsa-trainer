#!/usr/bin/env bash
# The straight path: one command per layer of the stack, bottom up. A GPT label on
# the disk, a partition inside the label, a physical volume on the partition, a
# volume group over the physical volume.
#
# Written as straight-line commands with no loop, no case and no conditional,
# because rung 4 of the disclosure ladder builds its command sketch from the
# sorted-first solution file by extracting leading words - see
# src/engine/disclosure/content.ts's commandSketch. This file is what the student
# reads there; the clever variant goes in 02.
set -euo pipefail

dev=$(cat /run/rhcsa-lab/042-spare-device)

sudo parted -s "$dev" mklabel gpt
sudo parted -s "$dev" mkpart pvdata 1MiB 1537MiB
sudo udevadm settle
sudo pvcreate "${dev}p1"
sudo vgcreate vgarchive "${dev}p1"
sudo vgs vgarchive
