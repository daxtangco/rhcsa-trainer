#!/usr/bin/env bash
# Route 1: the three tools the manual pages hand you, in the order the ticket
# reads. Straight-line commands only - rung 4 builds the student's command sketch
# out of this file, so nothing here is wrapped in a loop or a case.
set -euo pipefail

# The time zone. `timedatectl list-timezones` is where the exact spelling comes
# from; it is the same string this command wants.
sudo timedatectl set-timezone Asia/Tokyo

# The source. Every stock source line is commented out first, which is what deals
# with the `pool 2.rhel.pool.ntp.org iburst` line RHEL 9 ships - the site server
# is to be the only one. `&` in the replacement is the whole match, so
# `pool 2.rhel...` becomes `#pool 2.rhel...` and the original line stays readable
# for whoever comes after.
sudo sed -i -E 's/^[[:space:]]*(server|pool|peer)[[:space:]]/#&/' /etc/chrony.conf

# Then the one line the site wants. iburst is not required by anything here; it
# is the habit chrony's own documentation recommends, because it asks for the
# first few samples a second apart instead of waiting minutes.
printf 'server 192.0.2.10 iburst\n' | sudo tee -a /etc/chrony.conf >/dev/null

# Running now, and running again after the next reboot.
sudo systemctl enable --now chronyd

# Not redundant, and worth typing even here where chronyd was stopped a moment
# ago: chronyd reads its configuration when it starts, so on a machine where it
# was already running the edit above would have changed nothing until this line.
# Getting into the habit is cheaper than remembering when it matters.
sudo systemctl restart chronyd

# The tuning profile. tuned has to be running before it can be told anything, so
# the service comes first - and `enable` is the half that survives the reboot.
sudo systemctl enable --now tuned
sudo tuned-adm profile throughput-performance

# What to look at afterwards, and what NOT to worry about: `chronyc -n sources`
# should list 192.0.2.10 and nothing else, `tuned-adm active` should name the
# profile, `timedatectl` should show the zone. The source will sit at reach 0 with
# state `?` forever, because this lab cannot route to it - that is the lab, not
# the answer.
sudo chronyc -n sources || true
sudo tuned-adm active
timedatectl
