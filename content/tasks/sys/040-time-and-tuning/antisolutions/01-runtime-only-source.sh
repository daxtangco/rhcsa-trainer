#!/usr/bin/env bash
# The near-miss that works perfectly today: the source is added to the RUNNING
# daemon and never written down.
#
# `chronyc add server` is a real, documented, useful command - it is how you add
# a source without restarting a daemon that is currently keeping the clock. What
# it is not is configuration. The source lives in chronyd's memory, `chronyc
# sources` shows it, the clock would be kept by it, and every check a student
# thinks to run is green. Then the machine reboots, chronyd starts from
# /etc/chrony.conf, and the source the ticket asked for is simply not there.
#
# The two verdicts see different things, which is why the phases differ:
#   chrony-source-live is right NOW and wrong after the reboot: @post.
#   chrony-source-persistent is wrong in both - nothing was ever written - so it
#   carries no phase.
# chrony-sole-source stays green throughout, because the stock pool line really
# was dealt with. That is deliberate: a fixture that got several things wrong at
# once would not prove which checkpoint catches which mistake.
# expect-fail: chrony-source-persistent, chrony-source-live@post
set -euo pipefail

sudo timedatectl set-timezone Asia/Tokyo

# The stock sources go, properly and permanently. This half is correct.
sudo sed -i -E 's/^[[:space:]]*(server|pool|peer)[[:space:]]/#&/' /etc/chrony.conf

# Started from that configuration, so the daemon comes up with no sources at all.
sudo systemctl enable --now chronyd

# ...and then the site server is handed to the running daemon and to nobody else.
# The retry is only because chronyd.service is Type=forking and the command
# socket appears a moment after systemctl returns; it has nothing to do with the
# mistake being demonstrated.
for _ in 1 2 3 4 5; do
  sudo chronyc add server 192.0.2.10 iburst && break
  sleep 1
done

# The tuning half is done properly, so a green tuned verdict proves the grader is
# looking at chrony rather than failing this fixture wholesale.
sudo systemctl enable --now tuned
sudo tuned-adm profile throughput-performance

sudo chronyc -n sources || true
