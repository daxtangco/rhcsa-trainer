#!/usr/bin/env bash
# Prepare the system for storage/014-grow-home-lv.
#
# Idempotent: reset reverts to the `clean` snapshot, but setup must also
# survive being run twice against the same machine.
set -euo pipefail

fail() { printf 'setup: %s\n' "$*" >&2; exit 1; }

# --- preconditions ---------------------------------------------------------
# These are guarantees from docs/vm-build-checklist.md. If any is missing the
# task is unsolvable, and a checkpoint failure would be misleading.
src=$(findmnt -no SOURCE --target /home 2>/dev/null || true)
case $src in
  /dev/mapper/rhel-home | /dev/rhel/home) ;;
  *) fail "/home must be its own LV (found: ${src:-nothing}); see docs/vm-build-checklist.md" ;;
esac

free_extents=$(sudo vgs --noheadings --nosuffix --units b -o vg_free rhel 2>/dev/null | tr -d ' ')
[[ -n $free_extents ]] || fail "volume group 'rhel' not found"
if (( free_extents < 5 * 1024 * 1024 * 1024 )); then
  fail "VG rhel has only ${free_extents} bytes free; this task needs at least 5 GiB"
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
