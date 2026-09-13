#!/usr/bin/env bash
# Correct in every measurable way right now, and gone after a reboot.
#
# Permission bits on a directory are inherently persistent - chmod writes to the
# inode - so the only way an otherwise-correct answer to this task can evaporate
# at a reboot is for the graded path to stop being the directory that was fixed.
# That is what this does: it mounts a tmpfs over /srv/payroll and sets everything
# up perfectly inside the mount. Every checkpoint measures the tmpfs in verdict
# A. Nothing was added to /etc/fstab, so after the reboot the mount is gone and
# the checkpoints measure the untouched directory underneath it, which is still
# the root-owned 0755 directory setup.sh created.
#
# This is a real class of mistake rather than a contrivance: "I mounted somewhere
# with more space over the project directory" is how a shared area ends up on a
# filesystem nobody wrote down. It is also the one shape that proves the
# directory checkpoints are re-measured after the reboot rather than remembered
# from verdict A.
#
# The umask half is done properly on purpose, so the fixture isolates one fault.
# content-preserved is NOT declared: the file is copied into the mount, so it is
# present in verdict A, and the original reappears underneath in verdict B - it
# is content-shared that breaks after the reboot, because the original still has
# its old root:root 0644.
#
# Re-derived checkpoint by checkpoint, because the phases here are the fiddliest
# in the task. Verdict A: the tmpfs is mounted and set up perfectly, so all nine
# pass - and they have to, or the harness skips verdict B and these six @post
# declarations are never tested at all (see the "no checkpoint passed before the
# reboot" guard in src/engine/validate/harness.ts). Verdict B: the mount is gone,
# so the five dir-* checkpoints measure the original root:root 0755 directory and
# fail; content-preserved measures the original handover.txt, which never moved,
# and PASSES - which is why it is not declared; content-shared measures that same
# file's original root:root 0644 and fails; and umask-dana and umask-erik pass in
# both verdicts because the /etc/profile.d drop-in is on the real root filesystem
# and survives the reboot.
# expect-fail: dir-group@post, dir-setgid@post, dir-sticky@post, dir-group-rwx@post, dir-no-other@post, content-shared@post
set -euo pipefail

sudo tee /etc/profile.d/payroll-umask.sh >/dev/null <<'EOF'
if id -nG 2>/dev/null | tr ' ' '\n' | grep -qx payroll; then
    umask 007
fi
EOF
sudo chmod 0644 /etc/profile.d/payroll-umask.sh

# Copy the data out before the mount hides it, then put it back inside the mount
# so that content-preserved passes in verdict A and this fixture tests exactly
# one thing.
sudo cp -a /srv/payroll/handover.txt /var/tmp/handover.notes
sudo mount -t tmpfs -o size=32m tmpfs /srv/payroll
sudo chgrp payroll /srv/payroll
sudo chmod 3770 /srv/payroll
sudo install -o root -g payroll -m 0660 /var/tmp/handover.notes /srv/payroll/handover.txt
sudo rm -f /var/tmp/handover.notes
