#!/usr/bin/env bash
# The mirror image of antisolutions/01: everything is written down correctly and
# the running daemon has never been told.
#
# chronyd reads /etc/chrony.conf once, when it starts. Here the service is
# enabled and started first - from the template's stock configuration - and the
# edit is made afterwards with no restart and no reload. `systemctl status
# chronyd` says active (running). `systemctl is-enabled` says enabled. The file
# says exactly what the ticket asked for. And the daemon that is actually keeping
# the clock is still pointed at the internet pool it was started with.
#
# This is the single most common way to get a service task wrong, on the exam and
# in production, and it is the reason chrony is graded twice: once against the
# file, once against the running daemon.
#
# chrony-source-live fails in verdict A only. The reboot does for the student what
# they forgot to do - chronyd starts again and reads the file - so after it the
# host is genuinely correct: @pre.
# expect-fail: chrony-source-live@pre
set -euo pipefail

sudo timedatectl set-timezone Asia/Tokyo

# Service first, while chrony.conf is still the template's. Note the ordering:
# this is the whole fixture.
sudo systemctl enable --now chronyd

# Now the configuration, and it is correct configuration - the stock pool line is
# commented out and the site server is added, so both of the on-disk checkpoints
# are satisfied.
sudo sed -i -E 's/^[[:space:]]*(server|pool|peer)[[:space:]]/#&/' /etc/chrony.conf
printf 'server 192.0.2.10 iburst\n' | sudo tee -a /etc/chrony.conf >/dev/null

# No `systemctl restart chronyd`. No `systemctl reload`. Nothing that would make
# the running daemon read what was just written. That omission is the mistake.

# The tuning half, done properly.
sudo systemctl enable --now tuned
sudo tuned-adm profile throughput-performance

# Worth looking at side by side: the file names 192.0.2.10, and this listing does
# not.
sudo chronyc -n sources || true
