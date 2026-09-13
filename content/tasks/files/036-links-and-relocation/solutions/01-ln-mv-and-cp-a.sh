#!/usr/bin/env bash
# The textbook path, one command per condition in the prompt, in the order the
# prompt states them.
#
# Straight-line on purpose: rung 4 builds the student-facing command sketch from
# the sorted-first solution file, so no loop and no case label appears at the top
# level here. The clever variant lives in 02.
#
# The two decisions this file makes, and they are the whole task:
#   `ln` without -s for current.log, because that name has to be a second
#     directory entry on probe-2026-03.log's inode and survive its rename.
#   `ln -s` with an ABSOLUTE target for the review entry, because it must not be
#     a second name on that inode - the capture's blocks have to be freed when
#     the collector deletes it - and because an absolute target cannot be
#     mis-resolved against the directory the link ends up in.
set -euo pipefail
sudo mv /srv/telemetry/incoming/probe-2026-01.log /srv/telemetry/probe-2026-01.log
sudo rmdir /srv/telemetry/incoming
sudo rm -f /srv/telemetry/core.4417
sudo rm -rf /srv/telemetry/scratch
sudo ln /srv/telemetry/probe-2026-03.log /srv/telemetry/current.log
sudo mkdir -p /srv/review
sudo ln -s /srv/telemetry/probe-2026-02.log /srv/review/probe-2026-02.log
sudo cp -a /srv/telemetry /srv/archive/telemetry
