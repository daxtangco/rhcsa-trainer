#!/usr/bin/env bash
# The drop-in is in the right directory, has the right filename, holds the right
# key and the right value - in the wrong section. `Nice=` configures the process
# a service starts, so it belongs to [Service]; under [Unit] systemd does not
# know the key, logs one warning line to the journal and carries on. The unit
# loads, the service restarts, everything reports success and the nice value is
# still 0.
#
# This is the near-miss that satisfies the letter of the answer and none of its
# point, and it is why index-nice-config reads the merged unit text
# section-aware: a grader that grepped for Nice=10 anywhere would pass this.
#
# Both nice checkpoints fail in both verdicts - there is nothing here for the
# reboot to change.
# expect-fail: index-nice-config, index-nice-running
set -euo pipefail

sudo pkill -TERM -f '[r]hcsa-lab-purge'
sleep 3

sudo mkdir -p /etc/systemd/system/rhcsa-lab-metrics.service.d
printf '[Unit]\nNice=10\n' | sudo tee /etc/systemd/system/rhcsa-lab-metrics.service.d/10-nice.conf >/dev/null
sudo systemctl daemon-reload
sudo systemctl restart rhcsa-lab-metrics.service
