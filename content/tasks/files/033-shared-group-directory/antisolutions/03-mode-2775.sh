#!/usr/bin/env bash
# `chmod 2775` - the mode almost everyone types from memory for a collaboration
# directory, and it is wrong twice over.
#
#   2 7 7 5
#   | | | +--- others may read the directory and read every file in it
#   | | +----- the group can work here (this part is right)
#   | +------- the owner can work here (right)
#   +--------- set-GID, so new files do belong to payroll (right)
#
# What is missing is the sticky bit, so any member can delete any other member's
# work, and the trailing 5, which contradicts "no user outside the payroll group
# may read, write or enter it". Everything else about this answer is correct,
# which is what makes it the useful detector: only the two checkpoints that
# describe those two faults may fail.
#
# The trailing 5 is also why this was the one fixture the old EACCES confound did
# not touch: others keep the execute bit, so student could still traverse the
# directory and read handover.txt without sudo, and content-preserved and
# content-shared passed here while failing for every correct answer. Nothing about
# this fixture changed when grade.sh started reading through `sudo -n` - the point
# is that it is no longer the *only* fixture those two checkpoints work on.
# expect-fail: dir-sticky, dir-no-other
set -euo pipefail

sudo chgrp payroll /srv/payroll
sudo chmod 2775 /srv/payroll

sudo chgrp payroll /srv/payroll/handover.txt
sudo chmod 0664 /srv/payroll/handover.txt

sudo tee /etc/profile.d/payroll-umask.sh >/dev/null <<'EOF'
if id -nG 2>/dev/null | tr ' ' '\n' | grep -qx payroll; then
    umask 007
fi
EOF
sudo chmod 0644 /etc/profile.d/payroll-umask.sh
