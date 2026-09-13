#!/usr/bin/env bash
# Did the whole task correctly and then kept going.
#
# The most human mistake in the set, and the only one here that is not a
# misunderstanding: every command is right, in the right order, on the right
# device, and the candidate simply did not stop where they were told to. Having
# built a volume group, carving a logical volume out of it and putting a
# filesystem on it is what you do next on every other day of your working life -
# and storage/034-new-volume-and-swap is a task in this same bank that asks for
# exactly those two steps. The instruction not to take them is in the prompt, and
# reading the whole prompt before typing is a graded skill on this exam.
#
# Six of the seven checkpoints pass, which is the point: this fixture is what
# proves space-untouched discriminates. If it ever reports 7/7 the invariant has
# stopped measuring anything, and the prompt would be asking for something again
# graded by nothing.
#
# Safe to run. The logical volume is created inside vgarchive, which lives entirely
# on this task's own manufactured loop device, so nothing that exists before this
# script runs is written to: VG rhel is not touched, no existing filesystem is
# reformatted, nothing is unmounted, and the ssh channel the verdict travels on has
# no relationship to this disk. setup.sh's undo removes the group and the volume
# with it on the next run (`vgremove -f -y` takes logical volumes too), and there
# is no reboot - reboot_check is false for this task.
# expect-fail: space-untouched
set -euo pipefail

# The guard belongs here rather than in setup.sh's tool list, deliberately.
# mkfs.xfs is the one tool in this task that no ANSWER needs - it is needed only to
# model this mistake - so a guest missing xfsprogs should cost this one fixture and
# not the four others setup.sh stages. Aborting non-zero is the loud form: the
# harness reports it as the anti-solution script failing, which names the cause,
# where a silently skipped mkfs would report a passing invariant and read as
# "space-untouched does not discriminate".
have_mkfs() {
  command -v mkfs.xfs >/dev/null 2>&1 || sudo sh -c 'command -v mkfs.xfs' >/dev/null 2>&1
}
have_mkfs || {
  printf '%s\n' "mkfs.xfs is not available on this guest (it ships in xfsprogs, which a default RHEL 9 install has because the root filesystem is XFS). This anti-solution cannot model the mistake it exists to model without it." >&2
  exit 1
}

dev=$(cat /run/rhcsa-lab/042-spare-device)

sudo parted -s "$dev" mklabel gpt
sudo parted -s "$dev" mkpart pvdata 1MiB 1537MiB
sudo udevadm settle
sudo pvcreate "${dev}p1"
sudo vgcreate vgarchive "${dev}p1"

# -y because there is no TTY to answer a wipe-signature prompt, and -l 100%FREE
# because "all of it" is what somebody who thought they were finishing the job
# would type.
sudo lvcreate -y -n archivedata -l 100%FREE vgarchive
sudo mkfs.xfs -q /dev/vgarchive/archivedata
