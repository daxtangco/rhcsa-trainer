#!/usr/bin/env bash
# The single most common real mistake with process priority: renice the running
# process and stop there. It is correct right now and gone at the next start of
# the service, because a nice value is a property of a process and not of the
# service that started it - nothing on disk remembers it.
#
# The two verdicts see different things, which is why the phases differ:
#   index-nice-config is wrong immediately and stays wrong: there is no Nice=
#   anywhere, in the unit, in a drop-in or in ExecStart.
#   index-nice-running is right until the reboot and wrong after it, because the
#   collector systemd starts at boot is a new process reading the same
#   unconfigured unit. That is the failure this task is about, and it is
#   invisible until the machine comes back.
#
# The kill half is deliberately correct, so a green first half proves the grader
# is looking at the nice value rather than failing the fixture wholesale.
# expect-fail: index-nice-config, index-nice-running@post
set -euo pipefail

sudo pkill -TERM -f '[r]hcsa-lab-purge'
sleep 3

# No drop-in, no unit edit, no daemon-reload. That omission is the whole point.
sudo renice -n 10 -p "$(systemctl show -p MainPID --value rhcsa-lab-metrics.service)"
