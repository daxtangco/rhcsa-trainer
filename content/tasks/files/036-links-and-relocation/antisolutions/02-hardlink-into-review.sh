#!/usr/bin/env bash
# The same mistake as 01 in the other direction, and the harder one to see: a hard
# link where a symbolic link was asked for.
#
# The review team can read the capture through /srv/review, so this looks finished.
# What it silently breaks is the condition the prompt spends a whole sentence on:
# the entry is a second name on the capture's inode, so when the collector deletes
# probe-2026-03.log from /srv/telemetry the link count only drops from 2 to 1 and
# not one block is freed. The cleanup job reports success every night and the
# filesystem never gets any emptier - the failure mode is a full disk weeks later
# with no obvious cause, which is why review-symlink is graded separately from
# review-resolves rather than folded into one "the review team can read it".
#
# review-resolves passes here, deliberately: the entry does resolve to the right
# file. Only the mechanism is wrong, and only the checkpoint about the mechanism
# fails.
# expect-fail: review-symlink
set -euo pipefail
sudo mv /srv/telemetry/incoming/probe-2026-01.log /srv/telemetry/probe-2026-01.log
sudo rmdir /srv/telemetry/incoming
sudo rm -f /srv/telemetry/core.4417
sudo rm -rf /srv/telemetry/scratch
sudo ln /srv/telemetry/probe-2026-03.log /srv/telemetry/current.log
sudo mkdir -p /srv/review
sudo ln /srv/telemetry/probe-2026-02.log /srv/review/probe-2026-02.log
sudo cp -a /srv/telemetry /srv/archive/telemetry
