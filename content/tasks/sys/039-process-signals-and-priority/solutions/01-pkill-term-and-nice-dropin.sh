#!/usr/bin/env bash
# Route 1, and the one the book teaches: signal the process by name, then put the
# nice value in a drop-in and restart the service so the running process picks it
# up.
#
# Straight-line on purpose - rung 4 builds its command sketch from this file, so
# it stays a list of commands with no loop and no conditional.
#
# The bracket in the pkill pattern is not a typo and it is worth understanding.
# `-f` matches a process's whole command line, and the command line of the `sudo`
# that is running this very pkill contains the pattern - so `sudo pkill -TERM -f
# rhcsa-lab-purge` signals its own parent as well as the target, sudo dies, and
# the shell sees exit 143 for a command that worked. `[r]hcsa` matches "rhcsa" as
# a regex, while the literal `[r]hcsa` in sudo's command line does not match it.
# The runaway still gets its SIGTERM either way, which is why a student typing
# this at a prompt gets away with the simpler spelling.
set -euo pipefail

# SIGTERM: the default, and a request rather than an execution. The job's own
# handler answers it, writes /var/log/rhcsa-lab/purge-shutdown.log and exits.
sudo pkill -TERM -f '[r]hcsa-lab-purge'

# The handler has to run `date` and append a line before the record exists.
# Measured at 0.11s from signal to a non-empty record on RHEL 9.8, even though
# the job is spinning in a pure-builtin loop; three seconds is slack, not a
# calibration, and a student typing this interactively never notices the gap.
sleep 3

# The nice value, where the next start will find it. A drop-in rather than an
# edit of the unit file: it is what `systemctl edit` writes, and it survives a
# package updating the unit underneath it.
sudo mkdir -p /etc/systemd/system/rhcsa-lab-metrics.service.d
printf '[Service]\nNice=10\n' | sudo tee /etc/systemd/system/rhcsa-lab-metrics.service.d/10-nice.conf >/dev/null

# systemd is still running the copy of the unit it read at boot until it is told
# otherwise.
sudo systemctl daemon-reload

# And the running process keeps the nice value it was started with, so the
# configuration above changes nothing until something starts a new one.
sudo systemctl restart rhcsa-lab-metrics.service
