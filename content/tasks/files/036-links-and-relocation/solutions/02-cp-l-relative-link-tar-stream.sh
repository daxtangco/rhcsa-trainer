#!/usr/bin/env bash
# Equally correct, and deliberately different in every place a grader could
# over-fit:
#
#   the hard link is made with `cp -l`, not `ln`, so a grader that looked for a
#     command or for a link count of exactly 2 rather than for inode identity
#     would reject it;
#   the review entry is a RELATIVE symbolic link (`ln -sr`), so a grader that
#     insisted on the absolute target 01 writes would reject it - the prompt asks
#     what the entry resolves to, and ../telemetry/probe-2026-02.log resolves
#     there correctly because -r computes the target from where the LINK will
#     live;
#   the debris goes through `find -delete` instead of `rm`;
#   the archive is a tar stream rather than a copy, which is the other standard
#     way to move a tree with its ownership, modes, timestamps, symlinks and hard
#     links intact. `-p` restores the modes, the extracting tar runs as root so
#     it restores the owners, and mtimes come back by default. --numeric-owner on
#     both ends keeps the mapping numeric rather than routing it through name
#     lookups.
#
# The one thing this file does NOT vary is `mv` for the misfiled capture, and it
# cannot: keeping the file's inode number means renaming it, and rename(2) within
# a filesystem is the only operation that does that. `-t` at least spells it
# differently.
set -euo pipefail
sudo mv -t /srv/telemetry /srv/telemetry/incoming/probe-2026-01.log
sudo rm -r /srv/telemetry/incoming /srv/telemetry/scratch
sudo find /srv/telemetry -maxdepth 1 -type f -name 'core.*' -delete

sudo cp -l /srv/telemetry/probe-2026-03.log /srv/telemetry/current.log

sudo install -d -m 0755 /srv/review
sudo ln -s -r -T /srv/telemetry/probe-2026-02.log /srv/review/probe-2026-02.log

sudo tar --numeric-owner -C /srv -cf - telemetry \
  | sudo tar --numeric-owner -C /srv/archive -xpf -
