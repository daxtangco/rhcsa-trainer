#!/usr/bin/env bash
# The single most common real mistake on this material: `ln -s` where a hard link
# was asked for, because `ln -s` is the form everybody remembers.
#
# It works. `cat /srv/telemetry/current.log` prints the capture, `ls -l` prints a
# tidy arrow, and nothing complains. It breaks at the one moment the prompt names:
# the collector renames probe-2026-03.log when it rotates, the symbolic link is
# resolved afresh on the next read, the path it stores no longer exists, and the
# data is unreachable through current.log. A hard link is a second directory entry
# on the inode and does not care what the other entry is called.
#
# Everything else in this file is the correct answer, so this fixture isolates
# that one decision.
# expect-fail: current-hardlink
set -euo pipefail
sudo mv /srv/telemetry/incoming/probe-2026-01.log /srv/telemetry/probe-2026-01.log
sudo rmdir /srv/telemetry/incoming
sudo rm -f /srv/telemetry/core.4417
sudo rm -rf /srv/telemetry/scratch
sudo ln -s /srv/telemetry/probe-2026-03.log /srv/telemetry/current.log
sudo mkdir -p /srv/review
sudo ln -s /srv/telemetry/probe-2026-02.log /srv/review/probe-2026-02.log
sudo cp -a /srv/telemetry /srv/archive/telemetry
