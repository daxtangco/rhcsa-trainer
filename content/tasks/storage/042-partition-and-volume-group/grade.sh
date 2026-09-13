#!/usr/bin/env bash
# Grader for storage/042-partition-and-volume-group.
#
# READ-ONLY. Changes nothing. Exit code is ignored; only the JSONL matters.
# assert.sh is prepended by loadTaskScripts (see harness.ts's loadTaskScripts),
# so its helpers are already here.
#
# Checkpoints that must fail before the student does anything. Everything not
# listed is an invariant and must PASS from the start.
# baseline-fail: disk-gpt, part-size, part-single, pv-on-partition, vg-created
#
# rhel-intact is the invariant, and it is deliberately NOT declared unprobed:
# antisolutions/04-added-to-rhel.sh breaks it on purpose by answering "assign a
# physical volume to a volume group" with `vgextend rhel`, which is a mistake a
# real candidate makes and which no reboot or unmount is needed to model. So it is
# emitted, named by that anti-solution's "# expect-fail:" and by no header here,
# which npm run lint:content reports as a note - the same shape as 014's
# home-from-lv. Unlike 014's var-intact there is nothing dangerous about probing
# it: the fixture adds a physical volume to VG rhel and moves no extents onto it,
# so /home stays mounted, the ssh channel the verdict travels on is untouched, and
# setup.sh's undo takes the device back out of the group on the next run.
#
# space-untouched is the second invariant and it is the same shape, for the same
# reason: it passes on the blank disk setup.sh hands over, so it does not belong
# in the baseline-fail list, and antisolutions/06-lvcreate-and-mkfs.sh names it.
# It exists because the prompt's "Stop there. Do not create any logical volume and
# do not put a filesystem on anything" was, for one batch, a requirement stated to
# the student and graded by nothing - which is worse than not asking, because a
# candidate who obeys it gains no credit and one who ignores it loses none. A
# requirement in a prompt is either graded or removed from the prompt; this is the
# graded half of that choice.
#
# What it is NOT is a check that the student used no filesystem tools anywhere.
# It reads the disk, so `mkfs` on some other device is out of its scope, and
# deliberately: this task's claim is about the state of the archive team's disk,
# not about the student's shell history.
#
# The device under test is READ from the file setup.sh wrote and the prompt sends
# the student to, never re-derived. `losetup --find` chooses it at staging time, so
# a grader that went looking for "a loop device" of its own would grade a different
# disk than the student was given the moment this guest had two.
set -uo pipefail

DEVFILE=/run/rhcsa-lab/042-spare-device
FACTS=/run/rhcsa-lab/042-facts

# Spelled identically in setup.sh. If these ever disagree the task becomes
# unsatisfiable for every answer.
WANT_VG=vgarchive
SYS_VG=rhel

# The prompt asks for "at least 1 GiB" and this floor is 16 MiB under it, for the
# same reason storage/014 and storage/034 keep a rounding allowance on their
# sizes: the number a correct answer lands on is not the number the student
# typed. `parted mkpart pvdata 1MiB 1GiB` - a perfectly reasonable reading of
# "1 GiB" - produces 1023 MiB, because parted's second argument is an END offset
# and the first megabyte went to the alignment gap. Blaming a candidate for one
# megabyte would be blaming them for parted's argument grammar. The allowance is
# far smaller than the smallest meaningful shortfall (the next plausible mistake
# is 512M, which fails), so this still catches what it exists to catch.
PART_MIN=$(to_bytes 1008M) || PART_MIN=

# ------------------------------------------------------------------ helpers

# One stamped fact from $FACTS. 0644 there, so no sudo: a grader that needed root
# to find out what it is grading would fail closed on a permission problem and
# report it as a wrong answer.
fact() {
  awk -F= -v k="$1" '$1 == k { v = substr($0, index($0, "=") + 1) } END { print v }' "$FACTS" 2>/dev/null
}

# Sorted, resolved device paths of the physical volumes in VG $1, one per line.
# MUST match setup.sh's copy exactly - it stamped the value this is compared
# against, and a difference in either direction is an invariant that fails for a
# reason the student did not cause.
#
# `< /dev/null` on the pvs call, the pattern sys/035's grader sets: this script
# arrives on ssh stdin (src/engine/vm/ssh.ts:167-168), and a child that read stdin
# would swallow the rest of the grader - checkpoints lost that way vanish from the
# JSONL silently instead of failing.
vg_pv_list() {
  local vg=$1 pv rest rp
  while read -r pv rest; do
    [[ -n $pv ]] || continue
    [[ ${rest:-} == "$vg" ]] || continue
    rp=$(readlink -f "$pv" 2>/dev/null)
    printf '%s\n' "${rp:-$pv}"
  done < <(sudo pvs --noheadings -o pv_name,vg_name 2>/dev/null < /dev/null) | sort
}

# Sorted logical volume names of VG $1, one per line. Also mirrored in setup.sh.
vg_lv_list() {
  sudo lvs --noheadings -o lv_name "$1" 2>/dev/null < /dev/null | tr -d '[:blank:]' | sort
}

# stdin's lines joined with single spaces, matching what setup.sh stamped.
oneline() {
  awk 'NF { printf "%s%s", (n++ ? " " : ""), $0 } END { printf "\n" }'
}

# ------------------------------------------------------- read the disk's name
dev=$(cat "$DEVFILE" 2>/dev/null | tr -d '[:space:]')
dev_fact=$(fact device)
rhel_pvs_want=$(fact rhel-pvs)
rhel_lvs_want=$(fact rhel-lvs)

# Fail closed, one reason at a time, and say which. bash treats an empty operand
# as 0, so `(( n >= PART_MIN ))` is TRUE when PART_MIN is empty - measured on the
# lab guest by storage/014 - which means a grader that could not compute its own
# target would report the size checkpoint as passing and tell the student they got
# it right. The same is true of every probe below when the device name is missing:
# lsblk with no argument describes the whole machine, and `is_on_disk "$pv" ""`
# would match nothing while looking like it had asked.
bad=''
if [[ -z ${PART_MIN:-} ]]; then
  bad='grader could not compute its size target: to_bytes failed, so assert.sh may not have been prepended or awk is missing'
elif [[ -z $dev ]]; then
  bad="$DEVFILE names no device, so the spare disk this task is graded on could not be found. setup.sh writes that file, and because the disk is a loop device that nothing re-attaches at boot, both it and the file are gone after a reboot - re-run setup for this task"
elif [[ ! -b $dev ]]; then
  bad="$DEVFILE names $dev, which is not a block device now. A loop device is not re-attached at boot, so this is what a reboot leaves behind - re-run setup for this task"
elif [[ -n $dev_fact && $dev_fact != "$dev" ]]; then
  bad="$DEVFILE names $dev but $FACTS records $dev_fact, so setup.sh did not finish or ran twice; nothing here could be graded honestly"
elif [[ -z $rhel_pvs_want || -z $rhel_lvs_want ]]; then
  bad="$FACTS does not record what volume group $SYS_VG looked like before the task started, so the invariant that it was left alone could not be graded; setup.sh stamps those facts"
fi

if [[ -n $bad ]]; then
  ck_fail disk-gpt "the spare disk carries a GPT partition table" "$bad"
  ck_fail part-size "the spare disk holds a partition of at least 1 GiB" "$bad"
  ck_fail part-single "the spare disk holds exactly one partition" "$bad"
  ck_fail pv-on-partition "the partition on the spare disk is an LVM physical volume" "$bad"
  ck_fail vg-created "volume group $WANT_VG exists and is built on the spare disk" "$bad"
  ck_fail rhel-intact "volume group $SYS_VG still has the physical and logical volumes it started with" "$bad"
  ck_fail space-untouched "the spare disk carries no logical volume and no filesystem" "$bad"
  exit 0
fi

# is_on_disk PV -> exit 0 if PV is $dev itself or a partition of $dev.
#
# The partition form is anchored (`^DEVp<digits>$`) rather than tested as a
# prefix, because /dev/loop1 is a prefix of /dev/loop10: a prefix test would call
# one disk's partition the other's on any guest that had both attached. Resolved
# first, because /dev/loop0p1, /dev/disk/by-partuuid/... and /dev/dm-* are all
# spellings LVM might print and only the canonical node compares reliably.
is_on_disk() {
  local pv=$1 rp
  rp=$(readlink -f "$pv" 2>/dev/null)
  rp=${rp:-$pv}
  [[ $rp == "$dev" ]] && return 0
  [[ $rp =~ ^${dev}p[0-9]+$ ]] && return 0
  return 1
}

# --- 1. what the kernel and the label say about the disk ------------------
# Two readings of the partition table, because they answer different questions and
# both matter:
#
#   the KERNEL's view (lsblk) is what LVM could actually be built on - a partition
#   the kernel has no node for cannot hold a physical volume, whatever the label
#   says;
#   the LABEL's view (parted) is what is written on the disk, which is what lets a
#   detail line tell "you created no partition" apart from "you created one and
#   the kernel has not re-read the table yet".
#
# Both awk programs run to EOF - no `exit`, no `head`, no `grep -q` - so neither
# pipeline can hit the SIGPIPE-under-pipefail trap content/lib/assert.sh documents.
parts=$(lsblk -bnrpo NAME,TYPE,SIZE "$dev" 2>/dev/null | awk '$2 == "part" { print $1, $3 }')
npart=$(printf '%s\n' "$parts" | awk 'NF { n++ } END { print n + 0 }')
maxsz=$(printf '%s\n' "$parts" | awk 'NF && $2 + 0 > m + 0 { m = $2 } END { print m + 0 }')

table=$(sudo parted -m -s "$dev" unit B print 2>/dev/null < /dev/null)
tbl_type=$(printf '%s\n' "$table" | awk -F: 'NR == 2 { print $6 }' | tr -d '[:blank:]')
tbl_parts=$(printf '%s\n' "$table" | awk -F: '/^[0-9]+:/ { n++ } END { print n + 0 }')

# --- 2. the label is GPT --------------------------------------------------
# blkid -p probes the device itself rather than the /run/blkid cache, so a stale
# cache entry cannot pass or fail this. parted's own reading is the fallback for
# the case where blkid declines to answer, and the two agree on the vocabulary
# that matters: `dos` for MBR, `gpt` for GPT.
pttype=$(sudo blkid -p -s PTTYPE -o value "$dev" 2>/dev/null < /dev/null | tr -d '[:blank:]')
[[ -n ${pttype:-} ]] || pttype=${tbl_type:-}

case ${pttype:-} in
  gpt)
    ck_pass disk-gpt "the spare disk carries a GPT partition table"
    ;;
  dos | msdos)
    ck_fail disk-gpt "the spare disk carries a GPT partition table" \
      "$dev carries an MBR (msdos) partition table; this task asks for GPT, and the label type is chosen when the table is created"
    ;;
  loop)
    # parted's pseudo-label for "no partition table, but a filesystem written
    # straight onto the whole device". MEASURED on parted 3.5, the RHEL 9
    # version: the filesystems libparted itself probes produce it - a
    # whole-device `mkswap` reports field 6 as `loop` - and an LVM label does
    # NOT. libparted carries no LVM prober (it links libblkid for topology
    # only), so `pvcreate /dev/loopN` leaves parted reporting `unknown` and
    # lands in the branch below, not here. This branch is kept because a student
    # who runs mkfs on the whole device really does arrive at it, and the
    # sentence below is true of that answer too.
    ck_fail disk-gpt "the spare disk carries a GPT partition table" \
      "$dev has no partition table at all: something was written directly onto the whole device instead. A partition table has to be created on the disk itself"
    ;;
  '' | unknown)
    # Two states share this branch, both measured on RHEL 9: a disk with nothing
    # on it at all (blkid prints no PTTYPE, parted says `unrecognised disk
    # label` and reports `unknown`), and a whole-device physical volume, where
    # blkid finds TYPE=LVM2_member but still no PTTYPE and parted still says
    # `unknown`. The detail names both, and pv-on-partition below says which of
    # the two this answer was.
    ck_fail disk-gpt "the spare disk carries a GPT partition table" \
      "no partition table was found on $dev: either none was ever created, or an LVM label or a filesystem was written straight onto the whole device instead of into a partition"
    ;;
  *)
    ck_fail disk-gpt "the spare disk carries a GPT partition table" \
      "the partition table on $dev is '$pttype', not gpt"
    ;;
esac

# --- 3. a partition big enough for the archive team -----------------------
# "At least one partition of at least 1 GiB", measured on the largest one, so this
# stays independent of part-single below: a student with a stray 512 MiB partition
# alongside a good 1 GiB one has met this requirement and failed that one, and the
# two detail lines then say two different true things.
if (( ${maxsz:-0} >= PART_MIN )); then
  ck_pass part-size "the spare disk holds a partition of at least 1 GiB"
elif (( ${npart:-0} == 0 )) && (( ${tbl_parts:-0} > 0 )); then
  ck_fail part-size "the spare disk holds a partition of at least 1 GiB" \
    "the partition table on $dev declares ${tbl_parts} partition(s) but the kernel has no device node for any of them, so nothing can be built on them yet; partprobe asks the kernel to re-read the table"
elif (( ${npart:-0} == 0 )); then
  ck_fail part-size "the spare disk holds a partition of at least 1 GiB" \
    "$dev has no partitions"
else
  ck_fail part-size "the spare disk holds a partition of at least 1 GiB" \
    "the largest partition on $dev is ${maxsz:-0} bytes, under the ${PART_MIN} bytes this task asks for"
fi

# --- 4. exactly one partition, and no leftovers --------------------------
# The delete half of the partition objective lands here: a candidate who sizes a
# partition wrongly and creates a second one instead of removing the first leaves
# the disk in exactly this state, and the fix is a deletion.
#
# The kernel count decides, and the label count can only ever fail it. That
# asymmetry is deliberate: `tbl_parts` is 0 when parted could not be run at all,
# and requiring `tbl_parts == 1` would then fail a correct answer for a missing
# tool. A label carrying two partitions where the kernel sees one is still caught,
# which is the case that matters - the leftover is on the disk either way.
if (( ${npart:-0} == 1 )) && (( ${tbl_parts:-0} <= 1 )); then
  ck_pass part-single "the spare disk holds exactly one partition"
elif (( ${npart:-0} == 0 )); then
  ck_fail part-single "the spare disk holds exactly one partition" \
    "$dev has no partitions"
elif (( ${npart:-0} > 1 )); then
  ck_fail part-single "the spare disk holds exactly one partition" \
    "$dev has ${npart} partitions and this task asks for one; the extra one has to be deleted, not left in place"
else
  ck_fail part-single "the spare disk holds exactly one partition" \
    "the partition table on $dev declares ${tbl_parts} partitions while the kernel sees ${npart}; the extra one has to be deleted"
fi

# --- 5. the partition is the physical volume, not the disk ---------------
# The distinction is the whole point of the checkpoint. `pvcreate /dev/loopN`
# gives a working volume group too, which is why a grader that only asked "is
# there a physical volume" would pass the answer that never partitioned anything
# - and antisolutions/01-pvcreate-whole-disk.sh is that answer.
#
# One pass over the physical volume table records both shapes and the volume group
# each belongs to, because checkpoint 6 needs the volume groups and asking twice
# invites the two answers to drift.
pv_part=''
pv_part_vg=''
pv_whole=''
pv_whole_vg=''
dev_vgs=' '
while read -r pv vg; do
  [[ -n $pv ]] || continue
  is_on_disk "$pv" || continue
  rp=$(readlink -f "$pv" 2>/dev/null)
  rp=${rp:-$pv}
  if [[ $rp == "$dev" ]]; then
    pv_whole=$rp
    pv_whole_vg=${vg:-}
  else
    pv_part=$rp
    pv_part_vg=${vg:-}
  fi
  [[ -n ${vg:-} ]] && dev_vgs+="$vg "
done < <(sudo pvs --noheadings -o pv_name,vg_name 2>/dev/null < /dev/null)

if [[ -n $pv_part ]]; then
  ck_pass pv-on-partition "the partition on the spare disk is an LVM physical volume"
elif [[ -n $pv_whole ]]; then
  ck_fail pv-on-partition "the partition on the spare disk is an LVM physical volume" \
    "the physical volume is $pv_whole, the whole disk. LVM accepts that, but this task asks for the partition to be the physical volume, and a disk used whole has no partition table to show for it"
else
  ck_fail pv-on-partition "the partition on the spare disk is an LVM physical volume" \
    "no physical volume was found on $dev or on any partition of it"
fi

# --- 6. the volume group exists and is built on this disk ----------------
# Deliberately NOT "its only physical volume is the partition". The requirement is
# that the new group is assigned this disk's physical volume; whether the student
# also spelled out `pvcreate` first, or let vgcreate initialise the physical volume
# for them, is not something this task grades - solutions/02 takes the second
# route on purpose. And keeping this checkpoint independent of pv-on-partition is
# what makes the whole-disk answer legible: there the volume group is fine and
# only the layer under it is wrong.
vg_exists=no
sudo vgs --noheadings -o vg_name "$WANT_VG" &>/dev/null < /dev/null && vg_exists=yes

# The accumulator is space-delimited on both ends so the membership test above
# cannot match a substring of another group's name; this is the same list with the
# padding taken off, for the detail line.
vgs_show=${dev_vgs# }
vgs_show=${vgs_show% }
[[ -n $vgs_show ]] || vgs_show='no volume group at all'

if [[ $vg_exists == yes && $dev_vgs == *" $WANT_VG "* ]]; then
  ck_pass vg-created "volume group $WANT_VG exists and is built on the spare disk"
elif [[ $vg_exists == yes ]]; then
  ck_fail vg-created "volume group $WANT_VG exists and is built on the spare disk" \
    "volume group $WANT_VG exists but none of its physical volumes is on $dev, so the archive team's group has no storage from this disk"
else
  ck_fail vg-created "volume group $WANT_VG exists and is built on the spare disk" \
    "there is no volume group named $WANT_VG; the physical volumes on $dev currently belong to: $vgs_show"
fi

# --- 7. the system volume group was left alone ---------------------------
# An invariant: it passes from the start, and exists to catch the answer that
# "assigns the physical volume to a volume group" by extending the one this system
# runs on. Compared against what setup.sh stamped rather than against a hardcoded
# /dev/sda2 and a hardcoded list of four volumes, so a guest built with a different
# layout does not fail this and blame the student.
#
# The missing-physical-volume count is asked as well as the two lists, because
# there is one state the lists alone would call intact: a physical volume added to
# $SYS_VG and then taken away with the disk, which leaves the group's own PV
# present, its volumes untouched, and its metadata referring to a device that is
# not there.
rhel_pvs_now=$(vg_pv_list "$SYS_VG" | oneline)
rhel_lvs_now=$(vg_lv_list "$SYS_VG" | oneline)
rhel_missing=$(sudo vgs --noheadings -o vg_missing_pv_count "$SYS_VG" 2>/dev/null < /dev/null | tr -d '[:blank:]')

if [[ -z $rhel_pvs_now || -z $rhel_lvs_now ]]; then
  ck_fail rhel-intact "volume group $SYS_VG still has the physical and logical volumes it started with" \
    "volume group $SYS_VG could not be read at all now, though it held '$rhel_pvs_want' and '$rhel_lvs_want' when this task was staged"
elif [[ $rhel_pvs_now != "$rhel_pvs_want" ]]; then
  ck_fail rhel-intact "volume group $SYS_VG still has the physical and logical volumes it started with" \
    "volume group $SYS_VG now has physical volumes '$rhel_pvs_now'; it had '$rhel_pvs_want'. This task asks for a NEW volume group named $WANT_VG, not for more space in the one the system runs on"
elif [[ $rhel_lvs_now != "$rhel_lvs_want" ]]; then
  ck_fail rhel-intact "volume group $SYS_VG still has the physical and logical volumes it started with" \
    "volume group $SYS_VG now has logical volumes '$rhel_lvs_now'; it had '$rhel_lvs_want'"
elif [[ ${rhel_missing:-0} != 0 ]]; then
  ck_fail rhel-intact "volume group $SYS_VG still has the physical and logical volumes it started with" \
    "volume group $SYS_VG is missing ${rhel_missing} physical volume(s): a device was added to it and is no longer there"
else
  ck_pass rhel-intact "volume group $SYS_VG still has the physical and logical volumes it started with"
fi

# --- 8. the space was left for the archive team --------------------------
# The second invariant. "Do not create any logical volume and do not put a
# filesystem on anything" is a real exam instruction - the candidate is being told
# where their job ends - and the two halves fail differently enough to be worth
# probing separately even though they share one checkpoint.
#
# The logical volume half is asked TWICE, of two different sources, because
# neither alone is sufficient:
#
#   `lvs` sees the volume group's METADATA, which still lists a volume that has
#   been deactivated with `lvchange -an` - a state lsblk shows nothing of. This is
#   the reading that decides.
#   lsblk sees the DEVICE TREE, which adds the one case the metadata misses:
#   something stacked on this disk that is not in $WANT_VG at all, because the
#   student built it under a group of some other name.
#
# A student who created a volume and then deactivated it has still not left the
# space untouched, which is why the metadata reading is not merely a fallback.
#
# The device-tree half is deliberately NOT matched against the string `lvm`.
# Verified in util-linux 2.37.4's misc-utils/lsblk.c get_type() - the version the
# guest ships - the TYPE column is: `part` for a partition; for a device-mapper
# node the DM_UUID PREFIX lowercased, which is `lvm` for a logical volume only
# while sysfs `dm/uuid` is readable and falls back to `dm` when it is not; `loop`
# for a loop device, so the disk row here reads `loop` and never `disk`; and
# `crypt` for LUKS. Matching one of those names would miss the others, so the test
# is structural instead: any node in this disk's tree that is neither the disk
# itself nor a partition of it is something the student stacked on it, whatever
# libdevmapper chose to call it. `is_on_disk` already draws exactly that line, and
# drawing it once is what keeps this checkpoint honest about a name it cannot
# predict.
#
# The filesystem half goes through `sudo blkid -p` per node rather than lsblk's
# FSTYPE column, for the reason checkpoint 2 already gives: lsblk answers from the
# udev database and /run/blkid, so a stale cache entry could pass or fail this,
# while `-p` probes the device itself. `LVM2_member` is accepted rather than
# treated as a signature, because it is what a physical volume looks like to
# libblkid and a physical volume is what the task asked for - the same measured
# fact checkpoint 2's `'' | unknown` branch rests on.
#
# Stacked nodes are not probed for a filesystem. A student who ran lvcreate and
# then mkfs has made one mistake with two symptoms, and the detail line below
# should name the first one; probing inside the volume as well would only let the
# message describe the consequence instead of the cause. `< /dev/null` on blkid
# for the usual reason, and it matters doubly inside a process substitution: a
# child that read stdin here would eat the rest of lsblk's output and shrink the
# tree this loop believes it saw.
lv_names=$(vg_lv_list "$WANT_VG" | oneline)

fs_hit=''
stacked_hit=''
while read -r node ntype; do
  [[ -n $node ]] || continue
  if ! is_on_disk "$node"; then
    stacked_hit="$node (which lsblk calls a '${ntype:-unknown}' device)"
    continue
  fi
  ftype=$(sudo blkid -p -s TYPE -o value "$node" 2>/dev/null < /dev/null | tr -d '[:blank:]')
  case ${ftype:-} in
    '' | LVM2_member) ;;
    *) fs_hit="$node holds a $ftype filesystem" ;;
  esac
done < <(lsblk -nrpo NAME,TYPE "$dev" 2>/dev/null)

if [[ -n $lv_names ]]; then
  ck_fail space-untouched "the spare disk carries no logical volume and no filesystem" \
    "volume group $WANT_VG already contains logical volume(s) '$lv_names'. The prompt asks for the group and nothing inside it - the archive team allocates its own space, and this task ends at the volume group"
elif [[ -n $stacked_hit ]]; then
  ck_fail space-untouched "the spare disk carries no logical volume and no filesystem" \
    "$stacked_hit is stacked on $dev, on top of the partition. The prompt asks for the volume group and nothing inside it"
elif [[ -n $fs_hit ]]; then
  ck_fail space-untouched "the spare disk carries no logical volume and no filesystem" \
    "$fs_hit. The prompt asks for the disk to be left with no filesystem on it: an LVM physical volume label is what this task wants there, and a filesystem written over the partition or the whole device is not the same thing"
else
  ck_pass space-untouched "the spare disk carries no logical volume and no filesystem"
fi
