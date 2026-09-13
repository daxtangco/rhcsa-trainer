#!/usr/bin/env bash
# "Copy the files into the archive directory", done the way it is usually typed:
# make the destination, then copy the contents with a glob.
#
# Two things go wrong at once and neither one prints a word.
#
# Ownership and timestamps. `cp` without -p or -a creates NEW files: they belong
# to whoever ran the command - root here, because it needed sudo - and their
# modification times are the moment the copy ran. The mode does come across, which
# is what makes this so convincing: `ls -l` shows the familiar rw-r----- and the
# two columns that matter have quietly changed. An archive whose timestamps are
# all "the day somebody archived it" has lost the only information it was made to
# preserve.
#
# The symbolic link. A glob hands `cp` the link itself as an argument, and a
# non-recursive `cp` of a symbolic link follows it and copies the file at the far
# end. collector.conf in the archive is now a full copy of the collector's config
# rather than a pointer to it. Note that `cp -r` on the DIRECTORY would not have
# done this - measured on coreutils 8.32, the version RHEL 9 ships: symbolic links
# met during a recursive descent are copied as symbolic links. It is naming the
# link directly that dereferences it, which is why this fixture copies the
# contents rather than the directory.
# expect-fail: archive-attrs, archive-symlink
set -euo pipefail
sudo mv /srv/telemetry/incoming/probe-2026-01.log /srv/telemetry/probe-2026-01.log
sudo rmdir /srv/telemetry/incoming
sudo rm -f /srv/telemetry/core.4417
sudo rm -rf /srv/telemetry/scratch
sudo ln /srv/telemetry/probe-2026-03.log /srv/telemetry/current.log
sudo mkdir -p /srv/review
sudo ln -s /srv/telemetry/probe-2026-02.log /srv/review/probe-2026-02.log

sudo mkdir -p /srv/archive/telemetry
# The glob is expanded by the unprivileged shell before sudo runs, which is fine:
# /srv/telemetry is world-readable and holds no subdirectories by this point, so
# every argument is a regular file or the symbolic link, and cp exits 0.
sudo cp /srv/telemetry/* /srv/archive/telemetry/
