#!/usr/bin/env bash
# The near-miss this whole task is built around, and the reason the task exists at
# all: every step is right, the archive is right, the transfer is right, the tree
# lands in the right place with the right contents and the right owner - and the
# permissions are quietly wrong.
#
# Nothing about the reasoning that gets a candidate here is careless. `tar -xzf` is
# the command everyone knows, it is what every README on the internet prints, and
# it works: no error, no warning, no non-zero exit. `ls -l` on the result shows a
# plausible tree. The only way to see the problem is to have the source next to it
# and compare column one, and the candidate has just spent five minutes proving to
# themselves that the transfer worked.
#
# What actually happens, measured on this guest's tar 1.34 extracting as an
# ordinary user:
#
#   ledger.csv 0660 arrives 0640. Without -p, tar creates each file and lets the
#     process umask mask the mode out of the archive. An ssh session on RHEL 9 has
#     umask 022 (/etc/login.defs UMASK 022, applied by pam_umask from
#     /etc/pam.d/postlogin; the shipped /etc/profile sets no umask of its own), so
#     the group-write bit is removed. The reporting group can no longer write to
#     the ledger, which is the one thing that file's mode was for.
#   rotate-reports.sh 2750 arrives 0750. This one is NOT a umask matter and that is
#     worth knowing: measured under umask 000, 002 and 022 in turn, the setgid bit
#     is dropped every time. tar does not restore setuid or setgid at all unless
#     permissions are asked for explicitly. So a candidate who "fixed" this by
#     loosening their umask would still lose it, and a guest with a looser default
#     umask cannot make this fixture pass by accident.
#
# So this fixture is a machine where the handover looks complete, the operator has
# every byte, and a script that needed to run with its group's privileges no longer
# does.
#
#   The mode is wrong from the moment the extraction runs and stays wrong: no
#   phase. A reboot does not repair a permission bit, and nothing here is runtime
#   state.
#   Everything else is deliberately correct, which is what makes one red line
#   readable as one mistake instead of a mess. In particular the modification times
#   ARE preserved - tar restores those without being asked - so the two adjacent
#   checkpoints separate cleanly: a red mode with a green time means the
#   extraction, and the reverse means the transport.
# expect-fail: unpacked-mode-preserved
set -euo pipefail

# The correct half, done properly, so the failure is unambiguously about the one
# missing flag.
tar -czf "$HOME/reports.tar.gz" -C /srv reports
timeout 25 scp -i /home/student/backup-key -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$HOME/reports.tar.gz" backupop@localhost:/home/backupop/reports.tar.gz < /dev/null

# And the one decision that ruins it: the extraction everyone types.
timeout 25 ssh -n -i /home/student/backup-key -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null backupop@localhost 'tar -xzf ~/reports.tar.gz' < /dev/null

# Everything a candidate would look at, and all of it looks fine. Read the mode
# column of ledger.csv and rotate-reports.sh against the source below and the
# difference is two characters in each.
timeout 25 ssh -n -i /home/student/backup-key -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null backupop@localhost 'ls -l ~/reports' < /dev/null
ls -l /srv/reports

# Where the answer actually is, and the habit worth taking away: numbers, not
# letters, and both trees side by side. `rwxr-s---` and `rwxr-x---` are one glyph
# apart and 2750 against 0750 is not.
stat -c '%a %n' /srv/reports/ledger.csv /srv/reports/rotate-reports.sh
timeout 25 ssh -n -i /home/student/backup-key -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null backupop@localhost 'stat -c "%a %n" ~/reports/ledger.csv ~/reports/rotate-reports.sh' < /dev/null
