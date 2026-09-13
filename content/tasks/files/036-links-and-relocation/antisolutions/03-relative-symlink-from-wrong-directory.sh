#!/usr/bin/env bash
# The symbolic link that prints perfectly and reads nothing.
#
# `ln -s` does not resolve its target when the link is created; it stores the
# string it was given. A relative string is resolved later, against the directory
# the LINK lives in - never the directory the command was typed in. Standing in
# /srv/telemetry, where `ls probe-2026-02.log` succeeds, makes the bare name feel
# correct, and the entry that lands in /srv/review points at
# /srv/review/probe-2026-02.log, which is itself: ELOOP, and `stat` on it fails
# outright.
#
# `ls -l /srv/review` shows `probe-2026-02.log -> probe-2026-02.log` and looks
# exactly like the intended answer, so nothing catches this except reading through
# the link. It is completely invisible until something does.
#
# review-symlink passes: it IS a symbolic link, and the prompt's disk-space
# condition is satisfied. Only review-resolves fails, which is the split those two
# checkpoints exist for.
# expect-fail: review-resolves
set -euo pipefail
sudo mv /srv/telemetry/incoming/probe-2026-01.log /srv/telemetry/probe-2026-01.log
sudo rmdir /srv/telemetry/incoming
sudo rm -f /srv/telemetry/core.4417
sudo rm -rf /srv/telemetry/scratch
sudo ln /srv/telemetry/probe-2026-03.log /srv/telemetry/current.log
sudo mkdir -p /srv/review

# The mistake, spelled the way it happens: cd to where the file is, then name it.
cd /srv/telemetry
sudo ln -s probe-2026-02.log /srv/review/probe-2026-02.log
cd /

sudo cp -a /srv/telemetry /srv/archive/telemetry
