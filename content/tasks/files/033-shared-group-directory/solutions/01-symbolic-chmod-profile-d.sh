#!/usr/bin/env bash
# Route 1: symbolic chmod on the directory, and one system-wide drop-in that
# hands the umask to every member of payroll.
#
# Deliberately different from solutions/02 in three ways the grader must not
# care about: symbolic mode instead of numeric, `chgrp` instead of `chown :`,
# and a system-wide /etc/profile.d file instead of a per-user startup file.
set -euo pipefail

# The group has to own the directory before set-GID means anything: the bit
# makes new files inherit the *directory's* group.
sudo chgrp payroll /srv/payroll

# g+rwxs is the collaboration half, o-rwx is the half people forget, and +t is
# what stops one member deleting another member's file. Three clauses, one
# resulting mode of 3770.
sudo chmod g+rwxs,o-rwx /srv/payroll
sudo chmod +t /srv/payroll

# set-GID is not retroactive, so the file that was already in the directory
# still belongs to root and still has to be fixed by hand.
sudo chgrp payroll /srv/payroll/handover.txt
sudo chmod g+rw /srv/payroll/handover.txt

# Sourced by /etc/profile *after* its own `umask 002 / umask 022` block, so this
# is the value a login shell ends up with. Conditional on group membership, so
# no other account on the system has its default permissions changed.
sudo tee /etc/profile.d/payroll-umask.sh >/dev/null <<'EOF'
# The payroll team collaborates in /srv/payroll: keep group write, deny others.
if id -nG 2>/dev/null | tr ' ' '\n' | grep -qx payroll; then
    umask 007
fi
EOF
sudo chmod 0644 /etc/profile.d/payroll-umask.sh
