#!/usr/bin/env bash
# Configured and not applied: the drop-in is correct and systemd has read it, but
# the collector running right now is the process that was started before any of
# it existed, and a running process keeps the nice value it was given. The
# ticket asked for both - "the process running right now, and every process the
# service starts from here on".
#
# The mirror image of antisolutions/01, and the pair is the point: one fixture
# gets the live process right and the configuration wrong, this one gets the
# configuration right and the live process wrong. Neither of the two nice
# checkpoints can be dropped without letting one of them through.
#
# @pre, because the reboot applies the configuration for free: verdict B starts a
# fresh process that reads the drop-in, so the omission repairs itself and the
# only chance to see it is before the machine restarts.
# expect-fail: index-nice-running@pre
set -euo pipefail

sudo pkill -TERM -f '[r]hcsa-lab-purge'
sleep 3

sudo mkdir -p /etc/systemd/system/rhcsa-lab-metrics.service.d
printf '[Service]\nNice=10\n' | sudo tee /etc/systemd/system/rhcsa-lab-metrics.service.d/10-nice.conf >/dev/null
# systemd knows about the drop-in now. The process does not, and nothing here
# restarts it or renices it.
sudo systemctl daemon-reload
