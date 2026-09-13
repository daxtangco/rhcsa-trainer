#!/usr/bin/env bash
# Read "put an archive copy at /srv/archive/telemetry" as "move it there".
#
# It is a real misreading and it produces the best-looking archive of any fixture
# here: a rename carries the owner, the group, the mode, the timestamps and the
# inode itself, so /srv/archive/telemetry is byte-for-byte and attribute-for-
# attribute exactly what was asked for. archive-attrs and archive-symlink both
# pass. What is gone is the source, and with it three other conditions that were
# already satisfied:
#
#   originals-intact  the captures were supposed to stay in /srv/telemetry.
#   current-hardlink  probe-2026-03.log has no name in /srv/telemetry any more, so
#                     there is nothing left for current.log to be a second name
#                     OF - even though current.log itself still holds the data.
#   review-resolves   the review entry is a symbolic link to a path that no longer
#                     exists. It dangles now instead of after the collector's
#                     cleanup, and it stayed a valid-looking symbolic link the
#                     whole time.
#   moved-in-place    probe-2026-01.log left /srv/telemetry again.
#
# This is the fixture that probes originals-intact, which is why that checkpoint is
# an invariant rather than an unprobed one.
# expect-fail: originals-intact, current-hardlink, review-resolves, moved-in-place
set -euo pipefail
sudo mv /srv/telemetry/incoming/probe-2026-01.log /srv/telemetry/probe-2026-01.log
sudo rmdir /srv/telemetry/incoming
sudo rm -f /srv/telemetry/core.4417
sudo rm -rf /srv/telemetry/scratch
sudo ln /srv/telemetry/probe-2026-03.log /srv/telemetry/current.log
sudo mkdir -p /srv/review
sudo ln -s /srv/telemetry/probe-2026-02.log /srv/review/probe-2026-02.log

sudo mkdir -p /srv/archive/telemetry
sudo cp -a /srv/telemetry/collector.conf /srv/archive/telemetry/collector.conf
sudo mv /srv/telemetry/probe-2026-01.log /srv/telemetry/probe-2026-02.log \
        /srv/telemetry/probe-2026-03.log /srv/archive/telemetry/
