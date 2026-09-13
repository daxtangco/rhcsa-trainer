#!/usr/bin/env bash
# Prepare the system for storage/034-new-volume-and-swap.
#
# Idempotent, and that word is load-bearing here rather than decorative. The
# harness reverts to the `clean` snapshot before every fixture, but a human who
# re-runs this setup by hand on a guest where the task has already been SOLVED
# must get a working task back - not an accusation that the image was built
# wrong, which is what a bare precondition check produces when it meets the
# student's own successful work. Everything this task creates is therefore
# removed by the undo block below, BEFORE any precondition is read. The
# preconditions then describe a machine the undo has already cleaned, so a
# failure from one of them really is a build defect or a mount nothing could
# release - and each message says which.
#
# Runs as student over ssh stdin with passwordless sudo and no TTY, so nothing
# here may prompt. setup.sh is itself delivered on that stdin
# (src/engine/vm/ssh.ts:167-168), so any command that might read stdin is given
# `< /dev/null`: otherwise it swallows the rest of this file and setup ends
# early with a zero exit status, having staged a machine nobody described.
set -euo pipefail

fail() { printf 'setup: %s\n' "$*" >&2; exit 1; }

PROJ=/srv/projects
FSTAB=/etc/fstab
UNITDIR=/etc/systemd/system

# The volumes this guest ships with, spelled exactly as grade.sh's
# PREEXISTING_LVS. Two independent jobs, one list: grade.sh uses it to decide
# what counts as a volume the student created, and the undo block below uses it
# as the set it must never remove. If the two ever disagree, the undo either
# eats a system volume or leaves a volume the grader counts as an answer.
PREEXISTING_LVS=" home root swap var "

# ------------------------------------------------------------------ helpers

# unit_field UNIT KEY -> the last KEY= value in UNIT, whitespace trimmed, empty
# if the key is absent. KEY is a literal word (What, Where), so interpolating it
# into the match expression is safe; the *values* are compared literally by the
# callers, because a mount point containing '.' must not match some other path.
unit_field() {
  awk -v k="$2" '
    $0 ~ "^[[:space:]]*" k "[[:space:]]*=" {
      v = substr($0, index($0, "=") + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
      last = v
    }
    END { if (last != "") print last }' "$1" 2>/dev/null
}

# spec_device SPEC -> the device node or file path SPEC names, exit 1 if it
# cannot be followed.
#
# Same grammar grade.sh's resolve_spec accepts, and for the same reason: the
# undo has to recognise its own work whichever of the six spellings the student
# used, not just the two this task's own solutions happen to write. Deciding by
# resolution rather than by text is also what keeps it from deleting an fstab
# line it merely finds familiar.
#
# `< /dev/null` on every blkid: these calls run inside loops that are reading
# /etc/fstab, and one of them is a `while read` over a process substitution, so
# a child that consumed stdin would eat the lines the loop has not reached yet.
spec_device() {
  local spec=$1 dev=''
  case $spec in
    UUID=*) dev=$(sudo blkid -U "${spec#UUID=}" 2>/dev/null < /dev/null || true) ;;
    LABEL=*) dev=$(sudo blkid -L "${spec#LABEL=}" 2>/dev/null < /dev/null || true) ;;
    PARTUUID=* | PARTLABEL=*) dev=$(sudo blkid -t "$spec" -o device 2>/dev/null < /dev/null | head -n1 || true) ;;
    /*) dev=$spec ;;
  esac
  [[ -n $dev ]] || return 1
  readlink -f "$dev" 2>/dev/null || printf '%s\n' "$dev"
}

# --- what the undo needs to be true before it touches anything ------------
# The undo removes "the swap this task added", and the only thing that
# distinguishes that from the swap the guest booted with is the original swap
# volume's own device node. If the volume group or that node cannot be found
# there is no safe undo at all, so stop here instead of guessing. Every other
# precondition is checked *after* the undo, because the undo is what makes them
# true again.
sudo vgs rhel &>/dev/null < /dev/null ||
  fail "volume group 'rhel' not found; this guest was not built to docs/vm-build-checklist.md"
orig_swap=$(readlink -f /dev/mapper/rhel-swap 2>/dev/null || true)
[[ -n $orig_swap ]] ||
  fail "/dev/mapper/rhel-swap does not resolve to a device node, so nothing can tell the guest's own swap apart from swap a previous attempt added; this guest was not built to docs/vm-build-checklist.md"

# --- undo what a previous attempt left behind ------------------------------
# Ordering is the whole design, and every step is a no-op if the step it undoes
# was never done:
#
#   1. switch off active swap that is not the original, so the volumes behind it
#      are closeable in step 5;
#   2. remove the boot configuration - units first, then fstab - while its UUID=
#      and LABEL= specs still resolve. After step 5 they cannot, and an entry
#      that can no longer be identified is an entry this script refuses to
#      touch;
#   3. unmount $PROJ and put the plain empty directory back;
#   4. unmount anything else a student-created volume is serving;
#   5. remove the student-created volumes, which is what returns their extents
#      to the volume group and is the half of this block the free-extent budget
#      below depends on.
#
# Nothing here names home, root, swap or var. Every loop is driven either by the
# literal $PROJ or by "an LV in VG rhel that is not one of the four", so /home,
# /var, the root filesystem and the original swap are out of reach by
# construction rather than by care.

# 1. Extra swap off.
#
# The list is taken first and acted on second. `swapoff` inside the loop would
# be running with /proc/swaps as its stdin while the kernel rewrites the file
# underneath the reader, and the entries after the first would be skipped.
extra_swaps=()
while read -r sw_name _; do
  [[ $sw_name == /* ]] || continue            # skips the "Filename" header row
  rp=$(readlink -f "$sw_name" 2>/dev/null || true)
  [[ ${rp:-$sw_name} == "$orig_swap" ]] && continue
  extra_swaps+=("$sw_name")
done < /proc/swaps
if (( ${#extra_swaps[@]} > 0 )); then
  for sw in "${extra_swaps[@]}"; do
    sudo swapoff "$sw" < /dev/null ||
      fail "a previous attempt left swap active on $sw and it could not be switched off; swap-added would pass before the student did anything. This is leftover state, not a build defect - revert to the \`clean\` snapshot"
  done
fi

# 2. Boot configuration.
#
# Units first. Disabled before deletion so the symlink in
# multi-user.target.wants/ goes with the unit; an orphaned symlink is enough for
# systemd to complain at the next boot about a unit that no longer exists.
config_changed=no

for unit in "$UNITDIR"/*.mount; do
  [[ -r $unit ]] || continue
  [[ $(unit_field "$unit" Where) == "$PROJ" ]] || continue
  sudo systemctl disable --now "${unit##*/}" &>/dev/null < /dev/null || true
  sudo rm -f "$unit"
  config_changed=yes
done

for unit in "$UNITDIR"/*.swap; do
  [[ -r $unit ]] || continue
  what=$(unit_field "$unit" What)
  [[ -n $what ]] || continue
  r=$(spec_device "$what" || true)
  # Three ways to be spared, and each one matters:
  #   - unresolvable: this script cannot prove the unit is this task's work, and
  #     a wrong guess takes the guest's own swap away. A unit pointing at
  #     nothing cannot activate anything either, so leaving it costs nothing
  #     that grade.sh measures - swap-persistent only counts a spec that
  #     resolves to swap which is actually active.
  #   - the original swap: never, under any spelling.
  #   - resolves to something that is not there any more: same argument as
  #     unresolvable.
  [[ -n $r && $r != "$orig_swap" ]] || continue
  [[ -b $r || -f $r ]] || continue
  sudo systemctl disable --now "${unit##*/}" &>/dev/null < /dev/null || true
  sudo rm -f "$unit"
  config_changed=yes
done

# Then fstab. Exactly two kinds of line are removed, and both are decided by
# resolving the line rather than by matching the text this task's solutions
# happen to write:
#   - field 2 is exactly $PROJ, whatever field 1 says, and
#   - field 3 is swap and field 1 resolves to a block device or a file that
#     exists and is not the original swap.
# Everything else is kept, comments included. A backup is taken before the
# rewrite because this is the one file in the undo whose corruption costs a
# boot: if the classification above is ever wrong, /etc/fstab.rhcsa-034.bak is
# what a human needs, and it is written only on the runs that change something.
fstab_new=''
fstab_changed=no
# `line` is initialised because the loop condition reads it after `read` has
# returned false, and `set -u` would abort on the very first iteration against
# an empty file. The `|| [[ -n $line ]]` half is there so a final line with no
# trailing newline is classified rather than dropped.
line=''
while IFS= read -r line || [[ -n $line ]]; do
  keep=yes
  # Classified on a leading-whitespace-stripped copy so that an indented comment
  # is recognised as a comment, which is what grade.sh's `/^[[:space:]]*#/`
  # already does. Without it, "  #UUID=x /srv/projects ext4 ..." parses as a
  # data line whose second field is the mount point, and a comment would be
  # deleted. The line itself is what gets written back, so whitespace the admin
  # chose is preserved on every line that survives.
  probe=${line#"${line%%[![:space:]]*}"}
  case $probe in
    '' | '#'*) ;;
    *)
      # The fields, read with the same whitespace rules awk uses in grade.sh.
      read -r f1 f2 f3 _ <<<"$probe" || true
      if [[ ${f2:-} == "$PROJ" ]]; then
        keep=no
      elif [[ ${f3:-} == swap ]]; then
        r=$(spec_device "${f1:-}" || true)
        if [[ -n $r && $r != "$orig_swap" ]] && { [[ -b $r ]] || [[ -f $r ]]; }; then
          keep=no
        fi
      fi
      ;;
  esac
  if [[ $keep == yes ]]; then
    fstab_new+=$line$'\n'
  else
    fstab_changed=yes
  fi
done < "$FSTAB"

if [[ $fstab_changed == yes ]]; then
  sudo cp -a "$FSTAB" "$FSTAB.rhcsa-034.bak" || true
  # tee, not a redirect into a new file: it rewrites the existing inode, so the
  # mode, the owner and the SELinux label of /etc/fstab are the ones the system
  # shipped rather than whatever this script would have created.
  printf '%s' "$fstab_new" | sudo tee "$FSTAB" >/dev/null ||
    fail "could not rewrite $FSTAB to remove the entries a previous attempt left behind; a copy of the original is at $FSTAB.rhcsa-034.bak"
  config_changed=yes
fi

# 3. $PROJ back to a plain empty directory.
#
# Bounded loop rather than `while`: a student can mount twice over the same
# point, and a mount that cannot be released has to be reported by the
# precondition below instead of spun on here.
for _ in 1 2 3; do
  [[ $(findmnt -no TARGET --target "$PROJ" 2>/dev/null | tail -n1 || true) == "$PROJ" ]] || break
  sudo umount "$PROJ" < /dev/null || break
done

# The prompt tells the student the directory "already exists and is still
# empty", so files an earlier attempt wrote to it while it was NOT mounted -
# they live on the root filesystem, invisible under any later mount - have to go
# too, or the promise is false on the second run. Guarded on the mount check
# above: if $PROJ is still a mount point this is skipped entirely, because there
# the contents are the student's filesystem and not this script's business. The
# directory is recreated at the bottom of this file.
if [[ $(findmnt -no TARGET --target "$PROJ" 2>/dev/null | tail -n1 || true) != "$PROJ" ]]; then
  sudo rm -rf -- "$PROJ"
fi

# 4 and 5. Student-created volumes: what they serve, then the volumes.
#
# The map is keyed on the resolved device node, because a mount is listed in
# /proc/self/mountinfo as /dev/mapper/rhel-projects while the student typed
# /dev/rhel/projects and lvs can be asked for either - three spellings of one
# object, and only the resolved node compares reliably.
declare -A lv_by_node=()
student_lvs=()
while read -r lv_name lv_path; do
  [[ -n $lv_name && -n ${lv_path:-} ]] || continue
  node=$(readlink -f "$lv_path" 2>/dev/null || true)
  [[ -n $node ]] || continue
  lv_by_node[$node]=$lv_name
  [[ $PREEXISTING_LVS == *" $lv_name "* ]] || student_lvs+=("$lv_name")
done < <(sudo lvs --noheadings -o lv_name,lv_dm_path rhel 2>/dev/null < /dev/null || true)

if (( ${#student_lvs[@]} > 0 )); then
  # Unmount every mount whose source is one of those volumes, wherever it is.
  # An abandoned attempt that mounted the volume at /mnt or /data is just as
  # much a leftover as one that mounted it at $PROJ, and lvremove will refuse
  # while any of them is open.
  while read -r src tgt; do
    # A bind mount is listed as SOURCE[/sub]; the bracketed part is not a path
    # component. Only volumes absent from a clean guest can survive the lookup
    # below, so no mount of the base system is reachable from here.
    src=${src%%\[*}
    [[ $src == /dev/* ]] || continue
    node=$(readlink -f "$src" 2>/dev/null || true)
    [[ -n $node ]] || continue
    lv_name=${lv_by_node[$node]:-}
    [[ -n $lv_name ]] || continue
    [[ $PREEXISTING_LVS != *" $lv_name "* ]] || continue
    sudo umount "$tgt" < /dev/null ||
      fail "rhel/$lv_name is a volume a previous attempt created and it is still mounted at $tgt, which could not be unmounted; \`fuser -vm $tgt\` names what is holding it. This is leftover state, not a build defect"
  done < <(findmnt -rno SOURCE,TARGET 2>/dev/null < /dev/null || true)

  for lv_name in "${student_lvs[@]}"; do
    # -y because there is no TTY to answer the "Do you really want to remove"
    # prompt, and `< /dev/null` because a version of lvm that asked anyway would
    # otherwise read this script.
    sudo lvremove -y "rhel/$lv_name" &>/dev/null < /dev/null ||
      fail "could not remove rhel/$lv_name, a volume a previous attempt created; its extents stay spent and the free-extent budget below cannot be met. This is leftover state, not a build defect - revert to the \`clean\` snapshot"
  done
  config_changed=yes
fi

# systemd caches both the unit directory and the mount units it generates from
# fstab, so one reload after the edits above keeps its view and the file system's
# in agreement. Skipped when nothing changed, which is the common case.
[[ $config_changed == no ]] || sudo systemctl daemon-reload < /dev/null || true

# --- preconditions ---------------------------------------------------------
# Convention inherited from storage/014-grow-home-lv: verify every precondition
# the *checkpoints* depend on, not only the ones this script needs to run. A
# precondition that only guards the script leaves the checkpoints free to pass
# or fail for reasons that have nothing to do with the student.
#
# There are ten checkpoints, and each block below names the ones it protects.
# Each block runs on a machine the undo has already cleaned, so its message
# distinguishes the two things it can now mean: a guest that was built wrong, or
# leftover state the undo could not release.

# 1. The volume group, and the free-extent budget.
#
# The budget, written down once so the next author does not have to derive it:
#
#   clean guest, VG rhel                 15.00 GiB free (root 12g, home 8g,
#                                        swap 2g, var 2g on one 40G disk)
#   storage/014-grow-home-lv, solved      -4 GiB, permanently. It grows /home
#                                        from 8 to 12 GiB, /home is XFS, and XFS
#                                        cannot shrink - so 014 is a one-shot
#                                        task and its own setup refuses to run a
#                                        second time on a guest where it
#                                        succeeded.
#   this task, solved                     -5 GiB, returned by the undo block
#                                        above on the next run of this file.
#   worst case this floor must survive    15 - 4 = 11 GiB, a guest where 014 has
#                                        been solved and this task has not.
#
# So the floor is 6 GiB. 5 GiB is what a literal solution spends - 4 GiB for the
# filesystem the prompt asks for, 1 GiB of swap - and the sixth is slack for a
# student who rounds the project volume up. The floor used to be 10 GiB, chosen
# to leave room for 014, and that number is what made the two tasks mutually
# exclusive: once both had been solved the VG had 15 - 4 - 5 = 6 GiB free, under
# this task's own 10 GiB floor, so this setup refused to restart and blamed the
# image for extents the student had spent correctly. Reclaiming those extents is
# what makes a 6 GiB floor honest; do not raise it again without re-deriving the
# table above.
# Protects projects-mounted, projects-lv-size, swap-added.
free_bytes=$(sudo vgs --noheadings --nosuffix --units b -o vg_free rhel 2>/dev/null < /dev/null | tr -d ' ')
[[ -n $free_bytes ]] || fail "could not read the free extents of volume group 'rhel'"
if (( free_bytes < 6 * 1024 * 1024 * 1024 )); then
  fail "VG rhel has only ${free_bytes} bytes of free extents and this task needs 6 GiB (4 GiB filesystem + 1 GiB swap + 1 GiB slack). The undo above returns everything this task creates, so something else is holding them: storage/014-grow-home-lv keeps 4 GiB for good once it has been solved, which still leaves 11 GiB, so a number below 6 GiB means extents spent by something neither task accounts for - revert to the \`clean\` snapshot"
fi

# 2. The logical volume set is exactly the four the guest ships with.
#
# Two checkpoints rest on this. projects-mounted decides "the student created a
# *new* logical volume" by rejecting the four names in PREEXISTING_LVS, so an
# unexpected fifth LV would silently widen what counts as new. And a leftover
# volume from an abandoned attempt would have eaten the free extents measured
# above. This is a backstop: the undo removes every other volume and fails
# loudly if it cannot, so reaching this message means a volume appeared that the
# undo never saw.
lv_names=$(sudo lvs --noheadings -o lv_name rhel 2>/dev/null < /dev/null | tr -d ' ' | sort | tr '\n' ' ')
if [[ $lv_names != "home root swap var " ]]; then
  fail "VG rhel should hold exactly the volumes home, root, swap, var (found: ${lv_names:-none}). The grader treats any other volume name as student-created. The undo above removes those, so either this guest ships a fifth volume and was not built to docs/vm-build-checklist.md, or one appeared while setup was running"
fi

# 3. /home and /var are their own volumes at their documented sizes.
#
# home-intact and var-intact are invariants: they must PASS from the start, so
# a guest where /home is not its own LV would report a student-caused failure
# on the student's very first run. The bounds are lower bounds on purpose -
# storage/014-grow-home-lv legitimately grows /home to 12 GiB, and this task
# must not care. The undo never touches either volume, so these three messages
# describe the image and nothing else.
home_src=$(findmnt -no SOURCE --target /home 2>/dev/null || true)
case $home_src in
  /dev/mapper/rhel-home | /dev/rhel/home) ;;
  *) fail "/home must be its own LV (found: ${home_src:-nothing}); see docs/vm-build-checklist.md" ;;
esac
home_bytes=$(sudo lvs --noheadings --nosuffix --units b -o lv_size rhel/home 2>/dev/null < /dev/null | tr -d ' ')
[[ -n $home_bytes ]] || fail "could not read the size of rhel/home"
# The floor matches grade.sh's HOME_MIN, allowance included, and for the same
# reason: LVM rounds down to whole 4 MiB extents, so the installer's "8 GiB"
# /home measures 8585740288 bytes on this guest - one extent short. Asserting a
# bare 8 GiB here aborted setup for every fixture and reported the image as
# misbuilt when it was built exactly to the checklist. Keep the two in step: a
# floor here that is stricter than the grader's rejects guests the grader would
# have been happy with, and a looser one lets through guests it will fail.
if (( home_bytes < 8128 * 1024 * 1024 )); then
  fail "rhel/home is ${home_bytes} bytes, under the floor the home-intact invariant asserts (8 GiB less a 64 MiB rounding allowance); nothing in this task shrinks /home, so this guest was not built to docs/vm-build-checklist.md"
fi

var_src=$(findmnt -no SOURCE --target /var 2>/dev/null || true)
case $var_src in
  /dev/mapper/rhel-var | /dev/rhel/var) ;;
  *) fail "/var must be its own LV (found: ${var_src:-nothing}); see docs/vm-build-checklist.md" ;;
esac
var_bytes=$(sudo lvs --noheadings --nosuffix --units b -o lv_size rhel/var 2>/dev/null < /dev/null | tr -d ' ')
[[ -n $var_bytes ]] || fail "could not read the size of rhel/var"
# Same allowance as VAR_MIN. rhel/var happens to land on exactly 2 GiB on this
# guest, so a bare 2 GiB floor passes here today - but with zero margin, and the
# next guest built with a slightly different layout would round down like /home
# did and abort setup for a reason that has nothing to do with the student.
if (( var_bytes < 1984 * 1024 * 1024 )); then
  fail "rhel/var is ${var_bytes} bytes, under the floor the var-intact invariant asserts (2 GiB less a 64 MiB rounding allowance); nothing in this task shrinks /var, so this guest was not built to docs/vm-build-checklist.md"
fi

# 4. The existing swap is a 2 GiB volume and it is active right now.
#
# old-swap-intact is the invariant that catches a student who "adds" swap by
# taking the existing swap away. It asserts both halves - the volume exists at
# 2 GiB, and something in /proc/swaps resolves to it - so both halves have to
# be true before anyone touches the machine.
swap_bytes=$(sudo lvs --noheadings --nosuffix --units b -o lv_size rhel/swap 2>/dev/null < /dev/null | tr -d ' ')
[[ -n $swap_bytes ]] || fail "could not read the size of rhel/swap"
# Same 64 MiB allowance as OLD_SWAP_MIN: measured, rhel/swap is 2143289344
# bytes, one 4 MiB extent short of the 2 GiB the installer was asked for.
if (( swap_bytes < 1984 * 1024 * 1024 )); then
  fail "rhel/swap is ${swap_bytes} bytes, under the floor the old-swap-intact invariant asserts (2 GiB less a 64 MiB rounding allowance); the undo above never touches rhel/swap, so either this guest was not built to docs/vm-build-checklist.md or an earlier attempt resized the guest's own swap - which a snapshot revert is the only way back from"
fi

# 5. rhel/swap is the ONLY active swap area.
#
# This is the precondition that keeps swap-added honest. That checkpoint passes
# when at least 1 GiB of swap is active that is not rhel/swap; if this guest
# already had a second swap area - a leftover swap file from an earlier
# attempt, say - swap-added would pass before the student did anything, which
# is a false pass dressed up as a solved task. The undo switches those off and
# fails loudly if it cannot, so this too is a backstop.
extra_swap=""
while read -r sw_name _ _; do
  [[ $sw_name == /* ]] || continue          # skips the "Filename" header row
  rp=$(readlink -f "$sw_name" 2>/dev/null || true)
  [[ -n $rp ]] || rp=$sw_name
  [[ $rp == "$orig_swap" ]] && continue
  extra_swap+="$sw_name "
done < /proc/swaps
[[ -z $extra_swap ]] || fail "swap is active on something other than rhel/swap (${extra_swap}) after the undo ran, so it was activated while setup was running; swap-added would pass with no work done"

# A plain loop rather than a `grep`/`while` pipeline: a pipeline's last stage
# runs in a subshell, so a flag set inside it is lost by the time this script
# reads it - and the flag would read as "not active", turning a healthy guest
# into a setup failure. old-swap-intact is graded on this exact fact, so the
# reading of it must not be clever.
orig_active=no
while read -r sw_name _ _; do
  [[ $sw_name == /* ]] || continue
  rp=$(readlink -f "$sw_name" 2>/dev/null || true)
  [[ ${rp:-$sw_name} == "$orig_swap" ]] && orig_active=yes
done < /proc/swaps
[[ $orig_active == yes ]] || fail "rhel/swap is not active in /proc/swaps, so the old-swap-intact invariant would fail before the student starts. The undo above only switches off swap that is NOT rhel/swap, so either this guest boots without its swap - see docs/vm-build-checklist.md - or an earlier attempt ran swapoff on it; \`swapon /dev/rhel/swap\` restores it for now, a snapshot revert restores it properly"

# 6. The existing swap comes back by itself after a reboot.
#
# reboot_check is true, so old-swap-intact is graded again in verdict B. If the
# guest activated its swap by hand rather than from a boot-time configuration,
# that invariant would fail after the reboot and blame the student. Coarse on
# purpose: any uncommented fstab line whose filesystem type is swap, or any
# .swap unit, is enough - this is a guest-build assertion, not a grading rule.
# The undo above keeps every swap entry that resolves to rhel/swap and every
# entry it cannot resolve, so it cannot be what emptied this.
if ! awk '/^[[:space:]]*#/ { next } NF >= 3 && $3 == "swap" { found = 1 } END { exit found ? 0 : 1 }' "$FSTAB" &&
   ! compgen -G "$UNITDIR/*.swap" >/dev/null; then
  fail "nothing in $FSTAB or $UNITDIR activates swap at boot, so the old-swap-intact invariant would fail after the reboot for reasons the student did not cause; see docs/vm-build-checklist.md"
fi

# 7. Nothing already mounts /srv/projects, and nothing already configures it.
#
# projects-mounted, projects-persistent and projects-by-uuid all have to fail
# at the unsolved baseline (grade.sh's `# baseline-fail:` header says so). A
# stale fstab line or .mount unit from a previous attempt would satisfy two of
# them for free - which is what the undo above exists to prevent, making these
# three the backstop that proves it worked.
mounted_at=$(findmnt -no TARGET --target "$PROJ" 2>/dev/null | tail -n1 || true)
[[ $mounted_at != "$PROJ" ]] || fail "$PROJ is still a mount point (source: $(findmnt -no SOURCE --target "$PROJ" 2>/dev/null || true)) after the undo tried to unmount it, so the goal checkpoints would pass with no work done; \`fuser -vm $PROJ\` names what is holding it, and a snapshot revert is the reliable way back"

if awk -v t="$PROJ" '/^[[:space:]]*#/ { next } NF >= 2 && $2 == t { found = 1 } END { exit found ? 0 : 1 }' "$FSTAB"; then
  fail "$FSTAB still carries an entry for $PROJ after the undo removed the ones it found, so projects-persistent would pass with no work done; the entry was added while setup was running"
fi

for unit in "$UNITDIR"/*.mount; do
  [[ -r $unit ]] || continue
  [[ $(unit_field "$unit" Where) == "$PROJ" ]] || continue
  fail "$unit still mounts $PROJ after the undo removed the units it found, so projects-persistent would pass with no work done"
done

# 8. The tool the task requires exists.
#
# projects-fstype demands ext4, which needs mkfs.ext4 from e2fsprogs. If it is
# absent the task is not merely hard, it is unsolvable, and the student would
# read that as their own mistake. e2fsprogs is on the DVD repos configured on
# this guest (rhcsa-baseos), so install it rather than failing - and then
# verify, because "dnf exited 0" and "the binary is there" are different
# claims. `< /dev/null` because dnf reads stdin, and the stdin here is the rest
# of this script.
if ! command -v mkfs.ext4 >/dev/null 2>&1; then
  sudo dnf -y install e2fsprogs >/dev/null 2>&1 < /dev/null || true
fi
command -v mkfs.ext4 >/dev/null 2>&1 ||
  fail "mkfs.ext4 is missing and e2fsprogs could not be installed from the DVD repos; the ext4 requirement is unsolvable on this guest"

# --- create the situation the prompt describes ----------------------------
# The prompt says the directory "already exists and is still empty", and that
# is deliberate rather than a convenience. It makes the baseline the *hard*
# one to grade: a plain directory on the root filesystem, which `findmnt
# --target` happily answers for with /dev/mapper/rhel-root. A grader that only
# asked "is the source an LV in VG rhel" would pass that. grade.sh therefore
# checks the mount point exactly, and this line is what keeps that check under
# test on every single run. It is also what puts the directory back after the
# undo above removed it.
sudo mkdir -p "$PROJ"
sudo chmod 0755 "$PROJ"
sudo chown root:root "$PROJ"

# The grader never reads history, but a student who reverts and sees their own
# previous commands has been given a hint nobody offered them.
: > "$HOME/.bash_history" 2>/dev/null || true

exit 0
