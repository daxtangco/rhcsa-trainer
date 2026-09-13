#!/usr/bin/env bash
# Grader for storage/034-new-volume-and-swap.
#
# READ-ONLY. Changes nothing. Exit code is ignored; only the JSONL matters.
# assert.sh is prepended by loadTaskScripts (see harness.ts's loadTaskScripts),
# so its helpers are already here.
#
# Checkpoints that must fail before the student does anything. Everything not
# listed is an invariant and must PASS from the start.
# baseline-fail: projects-mounted, projects-lv-size, projects-fstype, projects-persistent, projects-by-uuid, swap-added, swap-persistent
#
# Knowingly unprobed: no anti-solution can break home-intact or var-intact
# safely. Both are XFS, which cannot shrink, so damaging either means lvremove,
# a reformat, or unmounting a filesystem RHEL 9 holds busy - and /home is where
# the ssh session this task is graded over has its working directory, while
# breaking /var breaks journald, dnf and the mount unit generator on the next
# boot. The harness cannot tell "correctly broken" from "cannot be reached
# again". They are graded anyway, because a *student* can reach that state
# (lvreduce on the wrong volume while hunting for free extents is the classic
# way), and a task that quietly tolerated it would teach the wrong lesson. The
# risk accepted here is the same one storage/014-grow-home-lv accepts for its
# var-intact: replacing either with an unconditional pass would still validate
# green across every fixture, so nothing here proves these two are live.
# unprobed-invariant: home-intact, var-intact

PROJ=/srv/projects

# The volumes this guest ships with. Anything else in VG rhel is, by
# definition, a volume the student created - which is how projects-mounted
# grades "a NEW logical volume" without naming one. setup.sh asserts this set
# is exactly right before the student starts, so a fifth pre-existing volume
# cannot quietly widen it.
PREEXISTING_LVS=" home root swap var "

DATA_MIN=$(to_bytes 4G) || DATA_MIN=
ADDED_SWAP_MIN=$(to_bytes 1G) || ADDED_SWAP_MIN=

# The three floors below are invariants on volumes the INSTALLER made, and they
# carry a 64 MiB rounding allowance off the round figures in
# docs/vm-build-checklist.md. LVM allocates whole 4 MiB extents, so an
# anaconda-created volume lands a little UNDER its nominal size rather than on
# it: measured on the lab guest, rhel/home is 8585740288 bytes and rhel/swap is
# 2143289344, each exactly one extent short of 8 GiB and 2 GiB. The bare
# `-ge $(to_bytes 8G)` these used to be therefore failed home-intact and
# old-swap-intact for EVERY fixture, both solutions included, and blamed the
# student for the installer's arithmetic. The allowance is far smaller than the
# smallest meaningful shrink (an lvresize is done in whole GiB), so these still
# catch the destructive answer they exist to catch.
#
# DATA_MIN and ADDED_SWAP_MIN above get no allowance and need none: they measure
# what the STUDENT creates, and `lvcreate -L 4G` is a whole number of extents
# exactly. The one place a correct answer does land short - mkswap spending a
# page on its header - is handled by the within_pct call at swap-added.
OLD_SWAP_MIN=$(to_bytes 1984M) || OLD_SWAP_MIN=   # 2 GiB - 64 MiB
HOME_MIN=$(to_bytes 8128M) || HOME_MIN=           # 8 GiB - 64 MiB
VAR_MIN=$(to_bytes 1984M) || VAR_MIN=             # 2 GiB - 64 MiB

# Fail closed. bash treats an empty operand as 0, so `[[ n -ge "$DATA_MIN" ]]`
# is TRUE when DATA_MIN is empty - measured - which means a grader that could
# not compute its own targets would report every size checkpoint as passing and
# tell the student they got it right. There is no safe way to continue without
# these, so every checkpoint fails with the reason attached.
if [[ -z $DATA_MIN || -z $ADDED_SWAP_MIN || -z $OLD_SWAP_MIN || -z $HOME_MIN || -z $VAR_MIN ]]; then
  detail='grader could not compute its size targets: to_bytes failed, so assert.sh may not have been prepended or awk is missing'
  ck_fail projects-mounted "/srv/projects is mounted from a new logical volume in volume group rhel" "$detail"
  ck_fail projects-lv-size "the logical volume behind /srv/projects is at least 4 GiB" "$detail"
  ck_fail projects-fstype "the filesystem mounted at /srv/projects is ext4" "$detail"
  ck_fail projects-persistent "/srv/projects is configured to mount at boot" "$detail"
  ck_fail projects-by-uuid "the boot configuration for /srv/projects names the filesystem by UUID or LABEL" "$detail"
  ck_fail swap-added "at least 1 GiB of additional swap is active alongside the original" "$detail"
  ck_fail swap-persistent "the additional swap is configured to activate at boot" "$detail"
  ck_fail old-swap-intact "the original rhel/swap volume still exists at its full size and is still active" "$detail"
  ck_fail home-intact "/home is untouched: still its own LV, still at full size" "$detail"
  ck_fail var-intact "/var is untouched: still its own LV, still at full size" "$detail"
  exit 0
fi

# ------------------------------------------------------------------ helpers

# lv_for_device DEV -> "vg lv size_bytes" for the logical volume DEV names.
#
# Matching is on the resolved device node, not on the string, because there are
# at least four spellings of the same volume: /dev/rhel/projects,
# /dev/mapper/rhel-projects, /dev/dm-4 and /dev/disk/by-uuid/... A grader that
# compared strings would accept one student's habit and reject another's, which
# is exactly the over-fitting the multi-solution rule exists to catch.
lv_for_device() {
  local want dm vg lv size rp
  want=$(readlink -f "$1" 2>/dev/null) || return 1
  [[ -n $want ]] || return 1
  while read -r dm vg lv size; do
    [[ -n $dm ]] || continue
    rp=$(readlink -f "$dm" 2>/dev/null) || continue
    if [[ $rp == "$want" ]]; then
      printf '%s %s %s\n' "$vg" "$lv" "$size"
      return 0
    fi
    # `< /dev/null` for the same reason it is on the blkid calls below: this
    # command substitution inherits the script's own stdin, which is the rest of
    # this grader.
  done < <(sudo lvs --noheadings --nosuffix --units b -o lv_dm_path,vg_name,lv_name,lv_size 2>/dev/null < /dev/null)
  return 1
}

# resolve_spec SPEC -> the device node an fstab/unit device spec points at.
#
# Accepts every spelling the persistence checkpoints have to treat as equal:
# UUID=, LABEL=, PARTUUID=, PARTLABEL=, a /dev/disk/by-*/ symlink, a plain
# device node, or the path of a swap file. Resolving rather than pattern
# matching is what makes swap-persistent and projects-persistent
# mechanism-agnostic: the question is which object the entry names, not how the
# student spelled it.
#
# `< /dev/null` on every blkid, the pattern
# content/tasks/sys/035-persistent-journal-and-schedule/grade.sh:206 sets. This
# grader reaches the guest on ssh stdin (src/engine/vm/ssh.ts:167-168) and both
# callers below run this function inside a `while read` loop fed by a process
# substitution, so a child that read stdin would swallow either the fstab lines
# the loop has not reached yet or the rest of this script - and checkpoints lost
# that way vanish from the JSONL silently instead of failing.
resolve_spec() {
  local spec=$1 dev=''
  case $spec in
    UUID=*) dev=$(sudo blkid -U "${spec#UUID=}" 2>/dev/null < /dev/null) ;;
    LABEL=*) dev=$(sudo blkid -L "${spec#LABEL=}" 2>/dev/null < /dev/null) ;;
    PARTUUID=*) dev=$(sudo blkid -t "PARTUUID=${spec#PARTUUID=}" -o device 2>/dev/null < /dev/null | head -n1) ;;
    PARTLABEL=*) dev=$(sudo blkid -t "PARTLABEL=${spec#PARTLABEL=}" -o device 2>/dev/null < /dev/null | head -n1) ;;
    *) dev=$spec ;;
  esac
  [[ -n $dev ]] || return 1
  # A swap file has no device node to resolve to, so fall back to the literal
  # path: /proc/swaps lists a file by exactly that path.
  readlink -f "$dev" 2>/dev/null || printf '%s\n' "$dev"
}

# spec_is_by_id SPEC -> exit 0 if SPEC identifies the filesystem by an id that
# travels with it, rather than by the position it happened to occupy at boot.
#
# The prompt asks for UUID or LABEL and this is where that is judged, so the
# accepted set is deliberately wider than those two words: /dev/disk/by-uuid/x
# and /dev/disk/by-label/x are the same promise written as a path, and udev
# builds both from the same superblock fields. PARTUUID/PARTLABEL are accepted
# too - they are GPT partition identities, not applicable to an LV, but they
# satisfy the objective's wording and rejecting them would be grading the
# storage layer instead of the requirement.
spec_is_by_id() {
  case $1 in
    UUID=* | LABEL=* | PARTUUID=* | PARTLABEL=*) return 0 ;;
    /dev/disk/by-uuid/* | /dev/disk/by-label/* | /dev/disk/by-partuuid/* | /dev/disk/by-partlabel/*) return 0 ;;
  esac
  return 1
}

# unit_what UNIT TARGET -> the What= of UNIT, but only if its Where= is exactly
# TARGET. Both values are compared literally, matching is_persistent in
# content/lib/assert.sh: interpolating a path into a regex would let a mount
# point containing '.' match some other path.
unit_what() {
  awk -v t="$2" '
    /^[[:space:]]*What[[:space:]]*=/ {
      w = substr($0, index($0, "=") + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", w)
    }
    /^[[:space:]]*Where[[:space:]]*=/ {
      v = substr($0, index($0, "=") + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
      if (v == t) ok = 1
    }
    END { if (ok && w != "") print w }' "$1" 2>/dev/null
}

# --- 1. /srv/projects is a mount point, served by a new logical volume ----
#
# The exact-mount-point test is the load-bearing half. setup.sh creates
# /srv/projects as an ordinary directory on the root filesystem, and
# `findmnt --target` answers for the *containing* mount, so on an untouched
# guest it reports /dev/mapper/rhel-root - a real logical volume in VG rhel. A
# grader that only asked "is the source an LV in rhel" would pass a student who
# did nothing at all.
proj_target=$(findmnt -no TARGET --target "$PROJ" 2>/dev/null | tail -n1 || true)
proj_src=''
proj_vg=''
proj_lv=''
proj_lv_bytes=0
proj_fstype=''
if [[ $proj_target == "$PROJ" ]]; then
  proj_src=$(mount_source "$PROJ" 2>/dev/null || true)
  proj_fstype=$(findmnt -no FSTYPE --target "$PROJ" 2>/dev/null | tail -n1 || true)
  lvinfo=$(lv_for_device "$proj_src" 2>/dev/null || true)
  if [[ -n $lvinfo ]]; then
    proj_vg=${lvinfo%% *}
    lvrest=${lvinfo#* }
    proj_lv=${lvrest%% *}
    proj_lv_bytes=${lvrest##* }
  fi
fi

# "New" is the whole point of the objective (create a logical volume), so
# reusing one of the four volumes the guest ships with does not count - and
# that also rules out the bind-mount answer, where /srv/projects is served by
# rhel/root under a different name.
proj_is_new_lv=no
if [[ $proj_vg == rhel && -n $proj_lv && $PREEXISTING_LVS != *" $proj_lv "* ]]; then
  proj_is_new_lv=yes
fi

if [[ $proj_is_new_lv == yes ]]; then
  ck_pass projects-mounted "/srv/projects is mounted from a new logical volume in volume group rhel"
elif [[ $proj_target != "$PROJ" ]]; then
  ck_fail projects-mounted "/srv/projects is mounted from a new logical volume in volume group rhel" \
    "nothing is mounted at $PROJ; it is still a directory inside the ${proj_target:-unknown} filesystem"
elif [[ -z $proj_vg ]]; then
  ck_fail projects-mounted "/srv/projects is mounted from a new logical volume in volume group rhel" \
    "$PROJ is mounted from ${proj_src:-nothing}, which is not a logical volume"
else
  ck_fail projects-mounted "/srv/projects is mounted from a new logical volume in volume group rhel" \
    "$PROJ is mounted from the pre-existing volume $proj_vg/$proj_lv; the task asks for a new one"
fi

# --- 2. the new volume is big enough --------------------------------------
# Measured on the volume rather than with df: ext4 reserves metadata, so a
# df-based 4 GiB threshold would sit within a percent of the real answer and
# turn a correct solution into a coin toss. lvs is the number the student asked
# lvcreate for.
if [[ ${proj_lv_bytes:-0} -ge $DATA_MIN ]]; then
  ck_pass projects-lv-size "the logical volume behind /srv/projects is at least 4 GiB"
elif [[ $proj_is_new_lv == no ]]; then
  ck_fail projects-lv-size "the logical volume behind /srv/projects is at least 4 GiB" \
    "no new logical volume is mounted at $PROJ, so there is no volume to measure"
else
  ck_fail projects-lv-size "the logical volume behind /srv/projects is at least 4 GiB" \
    "$proj_vg/$proj_lv is ${proj_lv_bytes:-0} bytes, under the 4 GiB asked for"
fi

# --- 3. it is ext4 --------------------------------------------------------
# The prompt asks for ext4 specifically, "not the system default". XFS is the
# default on RHEL 9, so accepting whatever is there would let the student skip
# the one filesystem decision the task contains. Read from findmnt, which
# reports what the kernel actually mounted - not from fstab, where a student
# can write ext4 and mount something else.
if [[ $proj_fstype == ext4 ]]; then
  ck_pass projects-fstype "the filesystem mounted at /srv/projects is ext4"
elif [[ $proj_target != "$PROJ" ]]; then
  ck_fail projects-fstype "the filesystem mounted at /srv/projects is ext4" \
    "nothing is mounted at $PROJ, so the filesystem type there is whatever ${proj_target:-/} uses"
else
  ck_fail projects-fstype "the filesystem mounted at /srv/projects is ext4" \
    "the filesystem at $PROJ is ${proj_fstype:-unknown}, not ext4"
fi

# --- 4. it comes back at boot --------------------------------------------
# Mechanism-agnostic (spec 6.5 rule 1): is_persistent accepts an fstab entry or
# a .mount unit, and which one the student chose is not the objective. It also
# rejects a noauto fstab entry, which is the one option that cancels the line it
# is written on. Its unit branch does not read options at all - a .mount unit
# that exists but was never enabled passes here and then fails to appear in
# verdict B, which is the backstop that makes the looser branch survivable.
if is_persistent "$PROJ"; then
  ck_pass projects-persistent "/srv/projects is configured to mount at boot"
else
  ck_fail projects-persistent "/srv/projects is configured to mount at boot" \
    "no uncommented /etc/fstab entry for $PROJ and no .mount unit with Where=$PROJ"
fi

# --- 5. and it is named by UUID or LABEL, not by device path --------------
# This is the objective itself ("mount file systems at boot by UUID or label"),
# so it is graded separately from persistence: an fstab line reading
# /dev/mapper/rhel-projects satisfies checkpoint 4 and fails this one, which is
# precisely the distinction the task is teaching.
#
# Every spec found for this mount point must be an id, not just one of them. A
# student who leaves a device-path line behind next to a UUID line has a
# machine that still breaks when the device name moves - the failure this
# objective exists to prevent - and "one of my two entries is right" is not the
# skill being certified.
proj_spec_count=0
proj_bad_specs=''
while read -r spec; do
  [[ -n $spec ]] || continue
  proj_spec_count=$((proj_spec_count + 1))
  spec_is_by_id "$spec" || proj_bad_specs+="$spec "
done < <(awk -v t="$PROJ" '
    /^[[:space:]]*#/ { next }
    NF >= 2 && $2 == t { print $1 }' /etc/fstab 2>/dev/null)

for unit in /etc/systemd/system/*.mount; do
  [[ -r $unit ]] || continue
  what=$(unit_what "$unit" "$PROJ")
  [[ -n $what ]] || continue
  proj_spec_count=$((proj_spec_count + 1))
  spec_is_by_id "$what" || proj_bad_specs+="$what "
done

if [[ $proj_spec_count -eq 0 ]]; then
  ck_fail projects-by-uuid "the boot configuration for /srv/projects names the filesystem by UUID or LABEL" \
    "nothing configures $PROJ at boot, so there is no device specification to check"
elif [[ -n $proj_bad_specs ]]; then
  ck_fail projects-by-uuid "the boot configuration for /srv/projects names the filesystem by UUID or LABEL" \
    "$PROJ is configured by device path: ${proj_bad_specs% }. Device names move when disks are added or removed; UUID= or LABEL= does not."
else
  ck_pass projects-by-uuid "the boot configuration for /srv/projects names the filesystem by UUID or LABEL"
fi

# --- 6. read the swap situation once -------------------------------------
# /proc/swaps is the only witness that matters: it lists what the kernel is
# actually using, so it cannot be satisfied by a correct-looking fstab line
# that was never activated. Sizes there are in 1024-byte units.
#
# "The original" is identified by resolved device node rather than by name, so
# a student who re-created the same volume under a different spelling is judged
# on the object, not the string.
orig_swap=$(readlink -f /dev/mapper/rhel-swap 2>/dev/null || true)
orig_swap_active=no
extra_swap_bytes=0
extra_swap_paths=''
# Four read variables for five columns on purpose: without the trailing
# catch-all, Used and Priority would be appended to sw_size and the arithmetic
# below would abort on "2097148 0 -2" instead of adding a gigabyte.
while read -r sw_name sw_type sw_size sw_rest; do
  # Skips the "Filename Type Size Used Priority" header row, and any future
  # column the kernel adds ahead of the data.
  [[ $sw_name == /* ]] || continue
  rp=$(readlink -f "$sw_name" 2>/dev/null || true)
  [[ -n $rp ]] || rp=$sw_name
  if [[ -n $orig_swap && $rp == "$orig_swap" ]]; then
    orig_swap_active=yes
  else
    extra_swap_bytes=$((extra_swap_bytes + sw_size * 1024))
    extra_swap_paths+="$rp "
  fi
done < /proc/swaps

# --- 7. additional swap is active ----------------------------------------
# Measured as "swap that is NOT the original", not as a total. A total would be
# satisfied by a student who swapped off the 2 GiB volume and swapped on a 3
# GiB replacement - the destructive answer the word "nondestructively" in the
# objective is there to rule out. antisolutions/04 is exactly that shape, and
# it is old-swap-intact that catches it, not this checkpoint.
#
# The tolerance is here because mkswap spends one page of the device on its
# header, so a 1 GiB volume offers a few KiB less than 1 GiB of swap - a bare
# -ge would fail a correct answer by 4096 bytes.
if [[ $extra_swap_bytes -gt 0 ]] &&
   { within_pct "$extra_swap_bytes" "$ADDED_SWAP_MIN" 2 || [[ $extra_swap_bytes -ge $ADDED_SWAP_MIN ]]; }; then
  ck_pass swap-added "at least 1 GiB of additional swap is active alongside the original"
elif [[ $extra_swap_bytes -eq 0 ]]; then
  ck_fail swap-added "at least 1 GiB of additional swap is active alongside the original" \
    "the only active swap is the original rhel/swap; /proc/swaps lists nothing else"
else
  ck_fail swap-added "at least 1 GiB of additional swap is active alongside the original" \
    "additional active swap totals ${extra_swap_bytes} bytes, under the 1 GiB asked for"
fi

# --- 8. the additional swap comes back at boot ---------------------------
# The same mechanism-agnostic rule as the mount: an fstab line whose filesystem
# type is swap, or a .swap unit, and the device may be named any of the ways
# resolve_spec understands. A swap file is accepted as readily as a volume -
# /proc/swaps lists it by path and fstab names it by path, so both sides
# already agree.
#
# noauto is excluded for the reason is_persistent excludes it: `swapon -a` and
# systemd's fstab generator both skip such an entry, so it will not be active
# after a reboot, which is the thing being asserted.
swap_persist=no
swap_specs_seen=''
while read -r spec; do
  [[ -n $spec ]] || continue
  swap_specs_seen+="$spec "
  r=$(resolve_spec "$spec" 2>/dev/null || true)
  [[ -n $r ]] || continue
  case " $extra_swap_paths " in
    *" $r "*) swap_persist=yes ;;
  esac
done < <(awk '
    /^[[:space:]]*#/ { next }
    NF >= 3 && $3 == "swap" && $4 !~ /(^|,)noauto(,|$)/ { print $1 }' /etc/fstab 2>/dev/null)

for unit in /etc/systemd/system/*.swap; do
  [[ -r $unit ]] || continue
  what=$(awk '
      /^[[:space:]]*What[[:space:]]*=/ {
        w = substr($0, index($0, "=") + 1)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", w)
        print w
        exit
      }' "$unit" 2>/dev/null)
  [[ -n $what ]] || continue
  swap_specs_seen+="$what "
  r=$(resolve_spec "$what" 2>/dev/null || true)
  [[ -n $r ]] || continue
  case " $extra_swap_paths " in
    *" $r "*) swap_persist=yes ;;
  esac
done

if [[ $swap_persist == yes ]]; then
  ck_pass swap-persistent "the additional swap is configured to activate at boot"
elif [[ $extra_swap_bytes -eq 0 ]]; then
  ck_fail swap-persistent "the additional swap is configured to activate at boot" \
    "there is no additional active swap to be persistent about; swap definitions found: ${swap_specs_seen:-none}"
else
  ck_fail swap-persistent "the additional swap is configured to activate at boot" \
    "the extra swap (${extra_swap_paths% }) is active but nothing in /etc/fstab or a .swap unit points at it; swap definitions found: ${swap_specs_seen:-none}. swapon alone lasts until the next boot."
fi

# --- 9. the original swap was not disturbed ------------------------------
# An invariant: it passes from the start. The objective says "nondestructively",
# and the wrong answer it names is reusing the existing swap volume - swapoff,
# lvremove, lvresize - instead of adding a second area. Both halves are graded
# because either alone is satisfiable by the wrong thing: the volume can still
# exist while being switched off, and something can be active while the volume
# has been resized underneath it.
old_swap_bytes=$(lv_size_bytes rhel swap || echo 0)
if [[ ${old_swap_bytes:-0} -ge $OLD_SWAP_MIN && $orig_swap_active == yes ]]; then
  ck_pass old-swap-intact "the original rhel/swap volume still exists at its full size and is still active"
elif [[ ${old_swap_bytes:-0} -lt $OLD_SWAP_MIN ]]; then
  ck_fail old-swap-intact "the original rhel/swap volume still exists at its full size and is still active" \
    "rhel/swap is ${old_swap_bytes:-0} bytes; it was 2 GiB and the task said to leave it alone"
else
  ck_fail old-swap-intact "the original rhel/swap volume still exists at its full size and is still active" \
    "rhel/swap exists but nothing in /proc/swaps resolves to ${orig_swap:-/dev/mapper/rhel-swap}; the original swap was switched off rather than left in use"
fi

# --- 10. /home was not raided for extents --------------------------------
# Invariant, lower bound rather than an equality: storage/014-grow-home-lv
# legitimately grows /home to 12 GiB on this same guest, and this task must not
# have an opinion about that. What it does have an opinion about is /home
# getting smaller, or ceasing to be its own volume, to fund the new one.
home_src=$(mount_source /home 2>/dev/null || true)
home_lv_bytes=$(lv_size_bytes rhel home || echo 0)
case $home_src in
  /dev/mapper/rhel-home | /dev/rhel/home)
    if [[ ${home_lv_bytes:-0} -ge $HOME_MIN ]]; then
      ck_pass home-intact "/home is untouched: still its own LV, still at full size"
    else
      ck_fail home-intact "/home is untouched: still its own LV, still at full size" \
        "rhel/home is now ${home_lv_bytes:-0} bytes"
    fi
    ;;
  *)
    ck_fail home-intact "/home is untouched: still its own LV, still at full size" \
      "/home is mounted from ${home_src:-nothing}"
    ;;
esac

# --- 11. and neither was /var -------------------------------------------
var_src=$(mount_source /var 2>/dev/null || true)
var_lv_bytes=$(lv_size_bytes rhel var || echo 0)
case $var_src in
  /dev/mapper/rhel-var | /dev/rhel/var)
    if [[ ${var_lv_bytes:-0} -ge $VAR_MIN ]]; then
      ck_pass var-intact "/var is untouched: still its own LV, still at full size"
    else
      ck_fail var-intact "/var is untouched: still its own LV, still at full size" \
        "rhel/var is now ${var_lv_bytes:-0} bytes"
    fi
    ;;
  *)
    ck_fail var-intact "/var is untouched: still its own LV, still at full size" \
      "/var is mounted from ${var_src:-nothing}"
    ;;
esac
