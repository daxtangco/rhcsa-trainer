#!/usr/bin/env bash
# Grader for storage/014-grow-home-lv.
#
# READ-ONLY. Changes nothing. Exit code is ignored; only the JSONL matters.
# assert.sh is prepended by loadTaskScripts (see harness.ts's loadTaskScripts),
# so its helpers are already here.
#
# Checkpoints that must fail before the student does anything. Everything not
# listed is an invariant and must PASS from the start.
# baseline-fail: lv-home-size, fs-home-size

TARGET=$(to_bytes 12G) || TARGET=
VAR_MIN=$(to_bytes 2G) || VAR_MIN=
HOME_LV_MIN=$TARGET

# Fail closed. bash treats an empty operand as 0, so `[[ n -ge "$TARGET" ]]` is
# TRUE when TARGET is empty - measured - which means a grader that could not
# compute its own targets would report every size checkpoint as passing and
# tell the student they got it right. There is no safe way to continue without these.
if [[ -z $TARGET || -z $VAR_MIN ]]; then
  detail='grader could not compute its size targets: to_bytes failed, so assert.sh may not have been prepended or awk is missing'
  ck_fail lv-home-size "logical volume rhel/home is at least 12 GiB" "$detail"
  ck_fail fs-home-size "the filesystem on /home is at least 12 GiB" "$detail"
  ck_fail home-from-lv "/home is mounted from the rhel/home logical volume" "$detail"
  ck_fail var-intact "/var is untouched: still its own LV, still at least 2 GiB" "$detail"
  ck_fail persist-config "/home is configured to mount at boot" "$detail"
  exit 0
fi

# --- 1. the logical volume grew -------------------------------------------
lv_bytes=$(lv_size_bytes rhel home || echo 0)
if [[ ${lv_bytes:-0} -ge $HOME_LV_MIN ]]; then
  ck_pass lv-home-size "logical volume rhel/home is at least 12 GiB"
else
  ck_fail lv-home-size "logical volume rhel/home is at least 12 GiB" \
    "rhel/home is ${lv_bytes:-0} bytes; lvextend grows the volume"
fi

# --- 2. the filesystem grew too, and it is still the LV's filesystem ------
# Both halves are needed. "fills its LV" passes on an untouched system, and
# "is 12 GiB" passes once /home falls back to the 12 GiB root filesystem.
home_src=$(mount_source /home 2>/dev/null || true)
home_on_lv=no
case $home_src in
  /dev/mapper/rhel-home | /dev/rhel/home) home_on_lv=yes ;;
esac

fs_bytes=$(fs_size_bytes /home 2>/dev/null || echo 0)

if [[ $home_on_lv == no ]]; then
  ck_fail fs-home-size "the filesystem on /home is at least 12 GiB" \
    "/home is not mounted from rhel/home (source: ${home_src:-none})"
# within_pct first, exact second. A 12 GiB XFS filesystem never reports 12 GiB
# usable — df shows space after metadata — so a bare `-ge $TARGET` fails both
# correct solutions and makes `6/6 fixtures ok` unreachable. This is exactly
# what within_pct exists for.
elif within_pct "${fs_bytes:-0}" "$TARGET" 2 || [[ ${fs_bytes:-0} -ge $TARGET ]]; then
  ck_pass fs-home-size "the filesystem on /home is at least 12 GiB"
else
  ck_fail fs-home-size "the filesystem on /home is at least 12 GiB" \
    "df reports ${fs_bytes:-0} bytes; growing the LV does not grow the filesystem inside it"
fi

# --- 3. /home is still served by its own logical volume -------------------
if [[ $home_on_lv == yes ]]; then
  ck_pass home-from-lv "/home is mounted from the rhel/home logical volume"
else
  ck_fail home-from-lv "/home is mounted from the rhel/home logical volume" \
    "findmnt reports ${home_src:-nothing} for /home"
fi

# --- 4. nothing was taken from /var --------------------------------------
# An invariant: it passes from the start, and exists to catch a destructive
# answer that funds /home by damaging something else.
#
# Knowingly unprobed: no anti-solution can break var-intact without risking a
# guest that does not boot. XFS cannot shrink, so damaging /var means lvremove,
# a reformat, or unmounting a filesystem RHEL 9 holds busy - and the harness
# cannot tell "correctly broken" from "unbootable" (see design decision 1).
# Replacing this pass with an unconditional one would validate green across
# all six fixtures; that is the risk being accepted here, not overlooked.
# unprobed-invariant: var-intact
var_src=$(mount_source /var 2>/dev/null || true)
var_lv=$(lv_size_bytes rhel var || echo 0)
case $var_src in
  /dev/mapper/rhel-var | /dev/rhel/var)
    if [[ ${var_lv:-0} -ge $VAR_MIN ]]; then
      ck_pass var-intact "/var is untouched: still its own LV, still at least 2 GiB"
    else
      ck_fail var-intact "/var is untouched: still its own LV, still at least 2 GiB" \
        "rhel/var is now ${var_lv:-0} bytes"
    fi
    ;;
  *)
    ck_fail var-intact "/var is untouched: still its own LV, still at least 2 GiB" \
      "/var is mounted from ${var_src:-nothing}"
    ;;
esac

# --- 5. it survives a reboot ---------------------------------------------
# Mechanism-agnostic on purpose (spec 6.5 rule 1): fstab and a systemd mount
# unit are both correct answers, and a UUID is as good as a device path.
if is_persistent /home; then
  ck_pass persist-config "/home is configured to mount at boot"
else
  ck_fail persist-config "/home is configured to mount at boot" \
    "no /home entry in /etc/fstab and no matching .mount unit"
fi
