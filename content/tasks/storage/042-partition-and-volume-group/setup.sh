#!/usr/bin/env bash
# Prepare the system for storage/042-partition-and-volume-group.
#
# This task needs a block device the student may destroy, and this guest has no
# spare disk: docs/vm-build-checklist.md provisions none, every task in the bank
# declares requires_disks: 0, and attaching one would mean rebuilding the golden
# image. So this script MANUFACTURES the disk - a sparse file attached with
# `losetup --partscan` - and leaves it completely blank: no partition table, no
# partition, no LVM label. Writing the GPT label, the partition, the physical
# volume and the volume group is the whole of the student's work.
#
# `--partscan` is the flag the task rests on. Without it the kernel never scans
# the loop device for a partition table, so after a correct `parted mkpart` there
# is no /dev/loopNp1 for pvcreate to work on and the task is unsolvable through no
# fault of the student. It is verified below by reading the flag back out of sysfs,
# because a silent default change here would present as five failing checkpoints
# and an accusation aimed at the wrong person.
#
# The resolved device name is written to $DEVFILE. That file, not a hardcoded
# /dev/loop0, is what the prompt tells the student to read and what grade.sh
# grades against: `losetup --find` picks the first free device, and while loop0 is
# in fact free on this guest (the DVD repo is a real CD-ROM device, /dev/sr1 - see
# scripts/guest-provision.sh's DVD block - so nothing here loop-mounts anything),
# "free today" is not a fact worth hardcoding into three files.
#
# Runs as student over ssh stdin: passwordless sudo, no TTY, no login shell. The
# script is itself delivered on that stdin (src/engine/vm/ssh.ts:167-168), so
# every command that might read stdin gets `< /dev/null` - otherwise it swallows
# the rest of this file and setup ends early, exit 0, having staged a machine
# nobody described.
#
# IDEMPOTENT, and it has to be for two different readers. The harness reverts the
# `clean` snapshot before every fixture, but a human studying in the Lab screen
# re-runs setup by hand on a guest they have already solved the task on - and by
# then the machine carries a volume group, a physical volume, a partition table
# and an attached loop device that all have to come off before the baseline
# assertions below can mean anything. The undo does that first, and every
# precondition is read afterwards, so a failure from one of them really is a build
# defect or leftover state nothing could release, and each message says which.
#
# `set -uo pipefail` without -e, the same deliberate divergence from
# storage/014-grow-home-lv that files/033, files/036 and sys/035 document: the
# undo is full of removals that legitimately fail on a first run. Commands that
# MUST work go through `need`, because a silent failure here stages the wrong
# machine and every checkpoint result afterwards is a lie.
set -uo pipefail

fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }
need() { "$@" || fail "FAILED: $*"; }

# The backing file lives on the ROOT filesystem, not under /var/lib/rhcsa-lab
# where the rest of the bank keeps its state, and that is a deliberate choice
# rather than an inconsistency. rhel/var is a 2 GiB logical volume on this guest
# (storage/014 and storage/034 both grade that size), and this is a 2 GiB sparse
# image: it costs nothing while it stays sparse, but a student experimenting with
# `dd if=/dev/zero of=/dev/loopN` would allocate every block of it and fill /var,
# taking journald, dnf and the next boot's mount unit generator with it. The root
# LV is 12 GiB with roughly 10 GiB free on a minimal install, so the same mistake
# there costs the student their own disk image and nothing else. The free-space
# floor below is what keeps that true.
IMG_DIR=/root/rhcsa-lab
IMG=$IMG_DIR/042-spare-disk.img
IMG_SIZE=2G
IMG_BYTES=$((2 * 1024 * 1024 * 1024))
# 3 GiB: the image is sparse, so it costs almost nothing today, but the floor is
# set against the size it would reach if every block in it were written.
MIN_FREE_KB=$((3 * 1024 * 1024))

# /run, not /var/lib, and for once the tmpfs is the feature: the pointer file
# dies at exactly the moment the thing it points at dies. A loop device is not
# re-attached at boot, so a stale /var/lib copy of this file would send both the
# student and the grader at a device that no longer exists, while an absent file
# says the truth - setup has not run since this machine booted.
RUNDIR=/run/rhcsa-lab
DEVFILE=$RUNDIR/042-spare-device
FACTS=$RUNDIR/042-facts

# Spelled identically in grade.sh. If these ever disagree the task becomes
# unsatisfiable for every answer.
WANT_VG=vgarchive
SYS_VG=rhel

# ------------------------------------------------------------------ helpers

# have CMD -> exit 0 if CMD can be run, as the student or under sudo.
#
# Both, because this script runs from a non-login non-interactive shell and gets
# whatever PATH sshd hands it. Every partitioning and LVM tool this task needs
# lives in /usr/sbin, and asking `command -v` alone would report a perfectly good
# guest as broken on any host whose default PATH omits it.
have() {
  command -v "$1" >/dev/null 2>&1 && return 0
  sudo sh -c "command -v $1" >/dev/null 2>&1
}

# Sorted, resolved device paths of the physical volumes in VG $1, one per line.
#
# MUST match grade.sh's copy exactly: this writes the fact the rhel-intact
# invariant is compared against, and a difference in either direction is a
# checkpoint that fails for a reason the student did not cause. Resolved with
# readlink because `pvs` prints the name from LVM's devices file, which is a
# /dev path but not necessarily the canonical one.
vg_pv_list() {
  local vg=$1 pv rest rp
  while read -r pv rest; do
    [[ -n $pv ]] || continue
    [[ ${rest:-} == "$vg" ]] || continue
    rp=$(readlink -f "$pv" 2>/dev/null)
    printf '%s\n' "${rp:-$pv}"
  done < <(sudo pvs --noheadings -o pv_name,vg_name 2>/dev/null < /dev/null) | sort
}

# Sorted logical volume names of VG $1, one per line. Also mirrored in grade.sh.
vg_lv_list() {
  sudo lvs --noheadings -o lv_name "$1" 2>/dev/null < /dev/null | tr -d '[:blank:]' | sort
}

# stdin's lines joined with single spaces. The canonical form both scripts store
# and compare, so "same set" is a string comparison and not an ordering puzzle.
oneline() {
  awk 'NF { printf "%s%s", (n++ ? " " : ""), $0 } END { printf "\n" }'
}

# is_on_disk PV DEV -> exit 0 if PV is DEV itself or a partition of DEV.
#
# The partition form is anchored (`^DEVp<digits>$`) rather than tested as a
# prefix, because /dev/loop1 is a prefix of /dev/loop10 and a prefix test would
# call one device's partition the other's on a guest that happened to have both.
is_on_disk() {
  local pv=$1 dev=$2 rp
  rp=$(readlink -f "$pv" 2>/dev/null)
  rp=${rp:-$pv}
  [[ $rp == "$dev" ]] && return 0
  [[ $rp =~ ^${dev}p[0-9]+$ ]] && return 0
  return 1
}

# --- packages -------------------------------------------------------------
# parted IS a mandatory member of @core, so a RHEL 9 Minimal Install has it and
# this branch should never be taken (verified against the RHEL 9 comps group, and
# scripts/guest-provision.sh does not list parted precisely because it does not
# need to). It is kept as a cheap guard rather than an assumption: the whole first
# objective rests on parted, guests get rebuilt and re-kickstarted, and a task that
# fails every checkpoint because one package is absent points the student at their
# own answer instead of at the image. If it ever does run it installs from the
# ISO-backed repo scripts/guest-provision.sh writes. `< /dev/null` because dnf
# reads stdin, and this script's stdin is the rest of this script. The install is
# verified with rpm -q afterwards: "dnf exited 0" and "the package is there" are
# different claims.
if ! rpm -q parted &>/dev/null; then
  sudo dnf -y install parted &>/dev/null < /dev/null
  rpm -q parted &>/dev/null \
    || fail "parted is not installed and 'dnf -y install parted' did not fix that; check that /etc/yum.repos.d/rhcsa-dvd.repo points at a mounted DVD (docs/vm-build-checklist.md section 3.3)"
fi

# --- the tools every checkpoint depends on --------------------------------
# Not only the ones this script runs. A precondition that guards the script alone
# leaves the checkpoints free to fail for reasons that have nothing to do with the
# student, and each of these is a tool without which some answer is unreachable:
#
#   losetup           this script cannot make the disk at all
#   truncate          nor the file behind it
#   parted            solutions/01 and three anti-solutions write the label with it
#   fdisk             solutions/02 writes the same label with a different tool
#   udevadm           every fixture waits on it after writing a partition table
#   wipefs            the ONLY way back from a wrong label. A student who writes
#                     msdos first has to erase it before GPT will take cleanly;
#                     without wipefs their own recovery path is missing and the
#                     task is one-shot per snapshot revert for them.
#   blkid, lsblk      how the grader reads the label and the partitions
#   partprobe         the hint grade.sh's detail text gives when the kernel has
#                     not picked up a written table
for t in losetup truncate parted fdisk udevadm wipefs blkid lsblk partprobe; do
  have "$t" \
    || fail "$t is missing from this guest; storage/042 cannot be staged or answered without it (parted and partprobe come from 'parted', fdisk/losetup/wipefs/blkid/lsblk from 'util-linux', udevadm from 'systemd-udev')"
done
for t in pvs pvcreate pvremove vgs vgcreate vgextend vgreduce vgremove lvs; do
  have "$t" \
    || fail "$t is missing from this guest, so the LVM half of this task can neither be answered nor graded; install lvm2"
done

# The system volume group has to be there before anything else is read: the
# rhel-intact invariant is graded against it, and the undo below decides what it
# may remove by asking which volume group a physical volume belongs to.
sudo vgs --noheadings -o vg_name "$SYS_VG" &>/dev/null < /dev/null \
  || fail "volume group '$SYS_VG' not found; this guest was not built to docs/vm-build-checklist.md"

# --- undo what a previous attempt left behind ------------------------------
# Ordering is the design, and every step is a no-op if the step it undoes was
# never done:
#
#   A. find the loop devices this task's image is attached to;
#   B. dismantle the LVM built on them - a volume group entirely on this task's
#      disk is this task's leftover and goes; a volume group with physical
#      volumes elsewhere too (that is `vgextend rhel`, which
#      antisolutions/04-added-to-rhel.sh does on purpose) keeps its own disks and
#      only loses ours;
#   C. remove the target volume group even when no physical volume of it is
#      visible, which is what a reboot leaves behind: the loop device is gone, so
#      the VG survives in metadata with nothing but missing PVs;
#   D. repair a $SYS_VG that is still carrying a missing physical volume;
#   E. detach the loop devices and delete the image.
#
# Nothing in here names a device: every step is driven by "a physical volume that
# resolves onto a loop device this image is attached to", so /dev/sda2, VG rhel's
# extents and every logical volume on them are out of reach by construction
# rather than by care.

# A. Matched on the backing-file path rather than with `losetup -j "$IMG"`, which
# compares inode identity and therefore misses a loop device still holding a
# DELETED earlier image of the same name - exactly what an interrupted previous
# run of this script leaves. losetup prints such an entry as
# "/root/rhcsa-lab/042-spare-disk.img (deleted)", so the prefix match catches both.
OUR_LOOPS=()
while read -r lname lback; do
  [[ $lname == /dev/loop* ]] || continue
  [[ ${lback:-} == "$IMG"* ]] || continue
  OUR_LOOPS+=("$lname")
done < <(sudo losetup --list --noheadings --output NAME,BACK-FILE 2>/dev/null < /dev/null)

# B. One reading of the physical volume table drives the whole dismantling.
#   on_ours[vg]  - how many of that VG's PVs sit on this task's disk
#   off_ours[vg] - how many sit anywhere else, including "[unknown]" for a PV
#                  whose device has gone missing
declare -A on_ours=()
declare -A off_ours=()
ours_pvs=()
while read -r pv vg; do
  [[ -n $pv ]] || continue
  hit=no
  for d in "${OUR_LOOPS[@]}"; do
    if is_on_disk "$pv" "$d"; then hit=yes; break; fi
  done
  if [[ $hit == yes ]]; then
    ours_pvs+=("$pv")
    [[ -n ${vg:-} ]] && on_ours[$vg]=$(( ${on_ours[$vg]:-0} + 1 ))
  else
    [[ -n ${vg:-} ]] && off_ours[$vg]=$(( ${off_ours[$vg]:-0} + 1 ))
  fi
done < <(sudo pvs --noheadings -o pv_name,vg_name 2>/dev/null < /dev/null)

for vg in "${!on_ours[@]}"; do
  if (( ${off_ours[$vg]:-0} == 0 )); then
    # Every physical volume of this group is on this task's own manufactured
    # disk, so the group cannot be anything but a leftover of this task: nothing
    # else in the bank creates a loop device. -f -y because there is no TTY to
    # answer "Do you really want to remove", and it also removes any logical
    # volume a previous attempt created inside it.
    sudo vgchange -an "$vg" &>/dev/null < /dev/null
    sudo vgremove -f -y "$vg" &>/dev/null < /dev/null \
      || fail "volume group '$vg' is built on this task's own loop device and could not be removed, so the disk cannot be handed back blank; something is still holding a logical volume in it ('sudo lvs $vg' lists them, 'fuser -vm <mountpoint>' names the holder). Leftover state, not a build defect - a revert to the \`clean\` snapshot is the reliable way back"
  else
    # A group with disks of its own as well: only take ours out of it. This is
    # the `vgextend rhel /dev/loopNp1` case, and vgreduce is refused outright by
    # LVM if the physical volume still holds extents, which is the safety this
    # branch relies on rather than a check of its own.
    for pv in "${ours_pvs[@]}"; do
      pvvg=$(sudo pvs --noheadings -o vg_name "$pv" 2>/dev/null < /dev/null | tr -d '[:blank:]')
      [[ ${pvvg:-} == "$vg" ]] || continue
      sudo vgreduce "$vg" "$pv" &>/dev/null < /dev/null \
        || fail "$pv, a physical volume on this task's own loop device, could not be removed from volume group '$vg'. If '$vg' is $SYS_VG this is antisolutions/04-added-to-rhel.sh's leftover and LVM is refusing because logical volume extents were allocated onto it: 'sudo pvmove $pv' moves them off, and a revert to the \`clean\` snapshot is the reliable way back"
    done
  fi
done

# C. The target volume group with no visible physical volume left. After a reboot
# the loop device is gone, so step B saw nothing of it, and `vgs` still lists the
# group - which would make vg-created pass before the student typed anything.
if sudo vgs --noheadings -o vg_name "$WANT_VG" &>/dev/null < /dev/null; then
  sudo vgchange -an "$WANT_VG" &>/dev/null < /dev/null
  sudo vgreduce --removemissing --force "$WANT_VG" &>/dev/null < /dev/null
  sudo vgremove -f -y "$WANT_VG" &>/dev/null < /dev/null
  if sudo vgs --noheadings -o vg_name "$WANT_VG" &>/dev/null < /dev/null; then
    fail "volume group '$WANT_VG' already exists and could not be removed, so vg-created would pass with no work done; revert to the \`clean\` snapshot"
  fi
fi

# D. $SYS_VG carrying a missing physical volume - the reboot-shaped leftover of
# `vgextend rhel /dev/loopNp1`. `vgreduce --removemissing` WITHOUT --force is the
# safe form and the reason this step is allowed to exist at all: LVM refuses it
# outright when the missing device still holds logical volume extents, so this
# can only ever drop an empty missing PV. Anything stronger than that on the
# system volume group is not this script's business.
missing=$(sudo vgs --noheadings -o vg_missing_pv_count "$SYS_VG" 2>/dev/null < /dev/null | tr -d '[:blank:]')
if [[ ${missing:-0} != 0 ]]; then
  sudo vgreduce --removemissing "$SYS_VG" &>/dev/null < /dev/null
  missing=$(sudo vgs --noheadings -o vg_missing_pv_count "$SYS_VG" 2>/dev/null < /dev/null | tr -d '[:blank:]')
  [[ ${missing:-0} == 0 ]] \
    || fail "volume group $SYS_VG is missing ${missing} physical volume(s) and 'vgreduce --removemissing' could not repair it without --force, which means the missing device still holds logical volume extents. Repairing that is beyond what this script may do to the volume group the system runs on: revert to the \`clean\` snapshot"
fi

# E. Detach and delete. pvremove and `lvmdevices --deldev` are best-effort
# housekeeping, not requirements: deleting the image is what really removes the
# physical volume, and the devices file entry that names a loop device is stale
# the moment the device is gone whether or not it is deleted here. They are worth
# doing because LVM prints warnings about both for as long as they linger, and a
# warning on stderr in a grader's output is a red herring somebody has to read.
for d in "${OUR_LOOPS[@]}"; do
  while read -r node; do
    [[ -n $node ]] || continue
    sudo pvremove -ff -y "$node" &>/dev/null < /dev/null
    sudo lvmdevices --deldev "$node" &>/dev/null < /dev/null
  done < <(lsblk -nrpo NAME "$d" 2>/dev/null)
  sudo losetup -d "$d" &>/dev/null < /dev/null \
    || fail "could not detach the loop device $d that a previous run left attached to $IMG; 'sudo losetup --list' shows it and 'sudo lsblk $d' shows what is stacked on it. Leftover state, not a build defect - revert to the \`clean\` snapshot"
done
sudo rm -f "$IMG" < /dev/null

# --- make the disk ---------------------------------------------------------
need sudo mkdir -p "$IMG_DIR"
need sudo chmod 0700 "$IMG_DIR"

# Room for the image at its FULL size, not at the size a sparse file starts out
# occupying. A student who writes to every block of it must run out of their own
# disk rather than out of the guest's.
free_kb=$(sudo df -k --output=avail "$IMG_DIR" 2>/dev/null < /dev/null | tail -n1 | tr -d '[:blank:]')
[[ -n ${free_kb:-} ]] || fail "could not read the free space on the filesystem holding $IMG_DIR"
(( free_kb >= MIN_FREE_KB )) \
  || fail "the filesystem holding $IMG_DIR has ${free_kb} KiB free and this task stages a ${IMG_SIZE} disk image on it, which needs at least ${MIN_FREE_KB} KiB to be safe even if every block of it is written. Free some space on the root filesystem, or revert to the \`clean\` snapshot"

# Sparse: `truncate` sets the size without allocating anything, so this costs a
# few kilobytes of metadata until something writes to the device.
need sudo truncate -s "$IMG_SIZE" "$IMG"
need sudo chmod 0600 "$IMG"
img_bytes=$(sudo stat -c %s "$IMG" 2>/dev/null < /dev/null | tr -d '[:blank:]')
[[ ${img_bytes:-0} == "$IMG_BYTES" ]] \
  || fail "$IMG came out ${img_bytes:-0} bytes, not $IMG_BYTES; the disk this task hands the student is the wrong size and the 1 GiB partition it asks for may not fit"

# `--partscan` is the whole reason this task is solvable; `--find --show` is what
# keeps the device name out of this file, the prompt and the grader.
dev=$(sudo losetup --partscan --find --show "$IMG" 2>/dev/null < /dev/null | tr -d '[:blank:]')
[[ -n ${dev:-} ]] \
  || fail "'losetup --partscan --find --show $IMG' produced no device name, so this task has no disk to offer. Either every loop device is in use ('sudo losetup --list' shows them) or the loop driver is unavailable on this kernel"
[[ $dev == /dev/loop* ]] \
  || fail "losetup reported '$dev', which is not a loop device path; this script cannot reason about it"
[[ -b $dev ]] \
  || fail "$dev is not a block device even though losetup reported it; the loop attach did not take"

# The flag, read back. Not decoration: a kernel or util-linux that stopped
# honouring --partscan would present as a task where a correct `parted mkpart`
# produces no /dev/loopNp1, which reads as four failing checkpoints and a student
# who did everything right. Guarded on readability so a kernel that does not
# export the attribute is not a setup failure by itself.
partscan_attr=/sys/block/${dev#/dev/}/loop/partscan
if [[ -r $partscan_attr ]]; then
  partscan=$(cat "$partscan_attr" 2>/dev/null | tr -d '[:blank:]')
  [[ ${partscan:-0} == 1 ]] \
    || fail "$dev was attached with --partscan but $partscan_attr reads '${partscan:-empty}', so the kernel will not scan it for partitions. A partition the student creates would get no device node and this task would be unsolvable"
fi

dev_bytes=$(lsblk -bdnro SIZE "$dev" 2>/dev/null | tr -d '[:blank:]')
[[ ${dev_bytes:-0} == "$IMG_BYTES" ]] \
  || fail "$dev reports ${dev_bytes:-0} bytes but its backing file is $IMG_BYTES; the kernel and the image disagree about the size of the disk"

# --- prove the disk is blank ----------------------------------------------
# One block per goal checkpoint, in grade.sh's order. A goal checkpoint that
# already passes here is a student-facing false pass, not a solved task. Each
# probe is the one grade.sh makes, not an approximation of it: `blkid -p` reads
# the device rather than the cache, and lsblk's TYPE=part rows are the kernel's
# own view of the partition table.

# disk-gpt
pttype=$(sudo blkid -p -s PTTYPE -o value "$dev" 2>/dev/null < /dev/null | tr -d '[:blank:]')
[[ -z ${pttype:-} ]] \
  || fail "$dev already carries a '$pttype' partition table straight after being created from a freshly truncated file, so disk-gpt could pass with no work done; the image was not blank"

# part-size and part-single
nparts=$(lsblk -nrpo NAME,TYPE "$dev" 2>/dev/null | awk '$2 == "part" { n++ } END { print n + 0 }')
[[ ${nparts:-0} == 0 ]] \
  || fail "$dev already has ${nparts} partition(s), so part-size and part-single could pass with no work done; the image was not blank"

# pv-on-partition and vg-created: nothing on this disk may already be a physical
# volume, whether the whole device or any partition of it.
pv_hit=''
while read -r pv rest; do
  [[ -n $pv ]] || continue
  if is_on_disk "$pv" "$dev"; then pv_hit="$pv ${rest:-(no volume group)}"; fi
done < <(sudo pvs --noheadings -o pv_name,vg_name 2>/dev/null < /dev/null)
[[ -z $pv_hit ]] \
  || fail "$dev already holds a physical volume ($pv_hit), so pv-on-partition and vg-created could pass with no work done; the image was not blank"

# vg-created, the other half. The undo above removes this group, so this is the
# backstop that proves it worked.
if sudo vgs --noheadings -o vg_name "$WANT_VG" &>/dev/null < /dev/null; then
  fail "volume group '$WANT_VG' exists after the undo removed the ones it found, so vg-created would pass with no work done; it was created while setup was running"
fi

# --- stamp the facts grade.sh compares against ---------------------------
# rhel-intact grades "volume group $SYS_VG was left exactly as it is", and the
# only truthful source for what "as it is" means is the machine as this script
# leaves it. Hardcoding the four installer volumes and /dev/sda2 into the grader
# would make the invariant fail on any guest built with a different layout and
# blame the student for it. Same device as files/036's stamp file, for the same
# reason.
rhel_pvs=$(vg_pv_list "$SYS_VG" | oneline)
rhel_lvs=$(vg_lv_list "$SYS_VG" | oneline)
[[ -n ${rhel_pvs:-} ]] \
  || fail "no physical volume of volume group $SYS_VG could be read, so the rhel-intact invariant could not be stamped and grade.sh would fail it closed for every fixture"
[[ -n ${rhel_lvs:-} ]] \
  || fail "no logical volume of volume group $SYS_VG could be read, so the rhel-intact invariant could not be stamped and grade.sh would fail it closed for every fixture"
[[ $rhel_lvs == *root* ]] \
  || fail "volume group $SYS_VG has no logical volume called 'root' (it has: $rhel_lvs); this guest was not built to docs/vm-build-checklist.md and the rhel-intact invariant would be measuring something else"

need sudo mkdir -p "$RUNDIR"
need sudo chmod 0755 "$RUNDIR"

# The pointer file the PROMPT sends the student to, and grade.sh reads the same
# one. 0644 because the student has to be able to read it without sudo, and
# because a grader that needed root to find out which disk it is grading would
# fail closed on a permission problem and call it a wrong answer.
printf '%s\n' "$dev" | sudo tee "$DEVFILE" >/dev/null \
  || fail "could not write $DEVFILE, so neither the student nor the grader could find out which device this task is about"
need sudo chmod 0644 "$DEVFILE"

{
  printf 'device=%s\n' "$dev"
  printf 'device-bytes=%s\n' "$dev_bytes"
  printf 'rhel-pvs=%s\n' "$rhel_pvs"
  printf 'rhel-lvs=%s\n' "$rhel_lvs"
} | sudo tee "$FACTS" >/dev/null \
  || fail "could not write $FACTS; grade.sh fails every checkpoint closed without it and no answer could pass"
need sudo chmod 0644 "$FACTS"

# Read every fact back the way grade.sh reads it, as the student. The grader
# fails closed on a missing fact, so a stamp that did not land is a task nobody
# can pass - better to say so here than to hand the student a grader that fails
# for a reason they cannot see.
fact() { awk -F= -v k="$1" '$1 == k { v = substr($0, index($0, "=") + 1) } END { print v }' "$FACTS" 2>/dev/null; }
for key in device device-bytes rhel-pvs rhel-lvs; do
  [[ -n $(fact "$key") ]] \
    || fail "$FACTS has no value for $key; grade.sh fails closed on that and no answer could pass"
done
[[ $(fact device) == "$dev" ]] \
  || fail "$FACTS records the device as '$(fact device)' but the disk that was attached is $dev"
readback=$(cat "$DEVFILE" 2>/dev/null | tr -d '[:space:]')
[[ $readback == "$dev" ]] \
  || fail "$DEVFILE reads back as '${readback:-empty}', not $dev; the prompt sends the student to that file"

# The grader never reads history, but a student who reverts and sees their own
# previous commands has been given a hint nobody offered them.
cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
