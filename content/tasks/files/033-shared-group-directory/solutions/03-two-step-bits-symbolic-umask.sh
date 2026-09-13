#!/usr/bin/env bash
# Route 3: the special bits applied in two steps, and the umask written in
# symbolic form.
#
# The third route exists to keep the grader honest about *values* as well as
# mechanisms. `umask u=rwx,g=rwx,o=` and `umask 007` are the same instruction
# spelled two ways - symbolic umask names the bits to KEEP, numeric names the
# bits to REMOVE - and the grader reads the resulting number, so both pass.
set -euo pipefail

# `chown user:group` in one command, then the special bits added on top of an
# ordinary numeric mode. 1770 first (sticky), then g+s: two commands where
# solutions/02 used one, with the same end state.
sudo chown root:payroll /srv/payroll
sudo chmod 1770 /srv/payroll
sudo chmod g+s /srv/payroll

sudo chgrp payroll /srv/payroll/handover.txt
sudo chmod g+rw,o-rwx /srv/payroll/handover.txt

# A `case` on the group list instead of a pipeline into grep: no forks, and it
# reads the same way. The surrounding spaces are what make it a whole-word test,
# so a group called `payrollers` cannot match.
sudo tee /etc/profile.d/collab-umask.sh >/dev/null <<'EOF'
# Collaboration umask for the payroll team: group keeps everything, others get
# nothing. Symbolic form: these are the permissions left ENABLED.
case " $(id -nG 2>/dev/null) " in
    *" payroll "*) umask u=rwx,g=rwx,o= ;;
esac
EOF
sudo chmod 0644 /etc/profile.d/collab-umask.sh
