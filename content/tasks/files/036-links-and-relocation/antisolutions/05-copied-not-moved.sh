#!/usr/bin/env bash
# Relocated the misfiled capture with a copy and a delete instead of a rename.
#
# This is the near-miss that satisfies the letter of the prompt and not the point
# of it. The file is in /srv/telemetry, it has the right name, and `cp -a`
# carried the owner, the group, the mode and the modification time across, so
# `ls -l` is indistinguishable from the correct answer. It is a different file:
# a new inode, freshly allocated blocks, and the old inode gone. Any hard link
# anyone else had made to the capture now refers to data nobody can reach by
# name, and a filesystem-level record of the original - its inode number - is
# lost for good.
#
# Only rename(2), which is what `mv` does within one filesystem, relocates a file
# without replacing it. moved-in-place compares the inode number setup.sh recorded
# and is the only checkpoint here that can tell the two apart.
# expect-fail: moved-in-place
set -euo pipefail
sudo cp -a /srv/telemetry/incoming/probe-2026-01.log /srv/telemetry/probe-2026-01.log
sudo rm -rf /srv/telemetry/incoming
sudo rm -f /srv/telemetry/core.4417
sudo rm -rf /srv/telemetry/scratch
sudo ln /srv/telemetry/probe-2026-03.log /srv/telemetry/current.log
sudo mkdir -p /srv/review
sudo ln -s /srv/telemetry/probe-2026-02.log /srv/review/probe-2026-02.log
sudo cp -a /srv/telemetry /srv/archive/telemetry
