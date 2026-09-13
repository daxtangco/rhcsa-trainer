#!/usr/bin/env bash
# Route 2, equally correct, and different from solutions/01 in every choice it
# makes:
#   - the runaway is stopped through systemd instead of with a signal sent by
#     hand. systemd sends the unit's stop signal - SIGTERM unless the unit says
#     otherwise - to the unit's whole cgroup, so the job's handler runs and the
#     shutdown record is written exactly as before. For anything systemd
#     started, this is the better habit: it also stops systemd from having an
#     opinion about the process disappearing.
#   - the nice value goes into the unit file itself rather than into a drop-in.
#   - the running process is reniced in place instead of being restarted. That
#     matters for a collector nobody wants to interrupt, and it proves the
#     grader is looking at the nice value rather than at a restart having
#     happened.
# A grader that required a drop-in, or required a restart, would reject all of
# this and it is all correct - which is the over-fitting risk this second
# solution exists to keep closed.
set -euo pipefail

UNIT=rhcsa-lab-metrics.service
UNIT_FILE=/etc/systemd/system/rhcsa-lab-metrics.service

# Stop returns once the unit has deactivated, which is after the job's handler
# has finished writing its record - so nothing here has to sleep. Measured on
# RHEL 9.8 / systemd 252 against a `systemd-run --collect` transient unit running
# this same trap-and-spin script: `systemctl stop` exits 0, the main pid is
# already gone the instant it returns, the record is already on disk, and the
# unit has been garbage-collected (LoadState=not-found). Re-running
# `systemd-run --unit=` with the same name straight afterwards also succeeds,
# which is what setup.sh's idempotency depends on.
sudo systemctl stop rhcsa-lab-purge.service

# Nice= belongs to the process the unit starts, so it goes in [Service]. In
# [Unit] it is silently ignored.
sudo sed -i '/^\[Service\]/a Nice=10' "$UNIT_FILE"
sudo systemctl daemon-reload

# The process that is already running was started with nice 0 and keeps it until
# something changes it. renice does that without a restart; the edit above is
# what makes the next start agree.
sudo renice -n 10 -p "$(systemctl show -p MainPID --value "$UNIT")"
