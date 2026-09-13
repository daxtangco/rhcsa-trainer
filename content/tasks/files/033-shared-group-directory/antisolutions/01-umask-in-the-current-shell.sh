#!/usr/bin/env bash
# The classic non-persistent answer: the directory is set up correctly, and the
# umask is typed into the shell that happens to be running - and nowhere else.
# Nothing on disk changed, so no other shell, no other login and no other user
# is affected.
#
# On the phase, because it is not what a first reading expects. This is declared
# for BOTH verdicts, not `@post`. grade.sh reads the umask out of a *fresh login
# shell* for each user, and the fresh shell it opens in verdict A has never seen
# the shell this script ran in - so the answer is already wrong before the
# reboot, not only after it. Declaring it `@post` would claim these checkpoints
# pass in verdict A, the harness would compare that against reality and fail the
# fixture. The reboot still earns its place on this task through
# antisolutions/02; this fixture proves the stronger property, which is that a
# umask has to come from a file some shell reads.
#
# The other seven checkpoints all PASS here, and that is the fixture's whole
# value: the directory is left on 3770 group payroll and handover.txt on 0660
# group payroll, which is a fully correct answer to every bullet in the prompt
# except the umask one. So exactly two checkpoints may fail, and if a third one
# does the grader is measuring something other than what it claims to. That
# includes content-preserved and content-shared, which are inside a directory
# 3770 shuts student out of - the reason grade.sh reads them through `sudo -n`.
# expect-fail: umask-dana, umask-erik
set -euo pipefail

sudo chgrp payroll /srv/payroll
sudo chmod 3770 /srv/payroll
sudo chgrp payroll /srv/payroll/handover.txt
sudo chmod 0660 /srv/payroll/handover.txt

# The whole mistake, in one line. It lasts exactly as long as this process.
umask 007
