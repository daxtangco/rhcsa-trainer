#!/usr/bin/env bash
# Prepare the system for storage/014-grow-home-lv.
#
# NOT idempotent, and it must not claim to be: /home is XFS, XFS cannot shrink,
# and nothing in this file reduces it, so once the task has been solved on a
# guest the only way back to a runnable baseline is a revert to the `clean`
# snapshot. The size precondition below says exactly that when it fires. This
# header used to promise the opposite, which is worse than useless: it invites
# the next author to "restore" idempotence by staging a machine on which
# lv-home-size and fs-home-size pass with no work done.
set -euo pipefail

fail() { printf 'setup: %s\n' "$*" >&2; exit 1; }

# --- preconditions ---------------------------------------------------------
# These are guarantees from docs/vm-build-checklist.md. If any is missing the
# task is unsolvable, and a checkpoint failure would be misleading.
#
# Convention for every task that clones this file: verify every precondition
# the goal checkpoints depend on, not only the ones needed for this script to
# run. A precondition that only guards the script leaves the checkpoints free
# to pass or fail for reasons that have nothing to do with the student.
src=$(findmnt -no SOURCE --target /home 2>/dev/null || true)
case $src in
  /dev/mapper/rhel-home | /dev/rhel/home) ;;
  *) fail "/home must be its own LV (found: ${src:-nothing}); see docs/vm-build-checklist.md" ;;
esac

# lv-home-size and fs-home-size both grade "/home reached 12 GiB", so the one
# precondition they actually depend on is /home's *starting* size, not just
# that it is its own LV. docs/vm-build-checklist.md:74 specifies an 8 GB LV;
# if the guest was built at or near 12 GiB already, the checkpoints would
# pass with no action taken - a student-facing false pass, not a solved task.
# Threshold is 11.5 GiB, not 12 GiB: fs-home-size accepts within_pct(..., 2),
# a +-2% tolerance on the 12 GiB target, so a /home already at 11.76 GiB would
# satisfy that checkpoint at baseline. 11.5 GiB sits safely under that margin.
home_lv_bytes=$(sudo lvs --noheadings --nosuffix --units b -o lv_size rhel/home 2>/dev/null | tr -d ' ')
[[ -n $home_lv_bytes ]] || fail "could not read the size of the rhel/home logical volume"
if (( home_lv_bytes >= 12348030976 )); then
  fail "rhel/home is already ${home_lv_bytes} bytes (>= 11.5 GiB), so lv-home-size and fs-home-size would pass with no work done. The likeliest cause is that this task has already been solved on this guest: /home is XFS, XFS cannot shrink, and nothing here reduces it - so this task is one-shot and a revert to the \`clean\` snapshot is what makes it runnable again. Only if this guest has never been solved is the size a build defect, and then docs/vm-build-checklist.md:74 is the line to check (it specifies an 8 GB LV)"
fi

free_extents=$(sudo vgs --noheadings --nosuffix --units b -o vg_free rhel 2>/dev/null | tr -d ' ')
[[ -n $free_extents ]] || fail "volume group 'rhel' not found"
if (( free_extents < 5 * 1024 * 1024 * 1024 )); then
  fail "VG rhel has only ${free_extents} bytes free; this task needs at least 5 GiB. A clean guest ships 15 GiB free, so something is holding the extents: storage/034-new-volume-and-swap spends 5 GiB on the same volume group and returns them the next time its own setup runs, so running that setup once will release them. Extents missing for any other reason mean a revert to the \`clean\` snapshot"
fi

# --- create the pressure the prompt describes -----------------------------
# A believable "/home is almost full" beats an instruction to resize something
# for no reason. fallocate is instant on XFS.
FILLER=/home/.rhcsa-filler.dat
if [[ ! -f $FILLER ]]; then
  sudo fallocate -l 6500M "$FILLER"
  sudo chmod 600 "$FILLER"
fi

# The grader never reads history, but a student who reverts and sees their own
# previous commands has been given a hint nobody offered them.
: > "$HOME/.bash_history" 2>/dev/null || true

exit 0
