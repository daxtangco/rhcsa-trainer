#!/usr/bin/env bash
# The pattern was too loose. `pkill -f` signals every process whose command line
# matches, and both jobs in this suite have "rhcsa-lab" in theirs - so the
# collector the ticket said to leave alone is killed along with the runaway.
#
# Nothing warns you. pkill prints nothing on success, the runaway really is gone,
# and the only sign that anything else happened is a unit sitting in `failed`
# that nobody looked at. This is the shape of the mistake that takes a database
# down while cleaning up a stuck backup script.
#
# Both failures are @pre. The collector's unit is enabled, so the reboot starts it
# again - with the drop-in below, at nice 10 - and by verdict B the machine looks
# as though nothing ever happened. That is exactly why the damage has to be
# detected at the moment it is done.
# expect-fail: index-alive@pre, index-nice-running@pre
set -euo pipefail

# The nice half, done properly and done first, so the only thing wrong with this
# fixture is what the kill catches.
sudo mkdir -p /etc/systemd/system/rhcsa-lab-metrics.service.d
printf '[Service]\nNice=10\n' | sudo tee /etc/systemd/system/rhcsa-lab-metrics.service.d/10-nice.conf >/dev/null
sudo systemctl daemon-reload
sudo systemctl restart rhcsa-lab-metrics.service

# "rhcsa-lab" instead of "rhcsa-lab-purge". The bracket only keeps the pattern
# from matching the sudo running it - it does nothing about the real defect,
# which is that the pattern names a suite rather than a process.
sudo pkill -TERM -f '[r]hcsa-lab'
sleep 3
