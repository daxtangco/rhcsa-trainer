#!/usr/bin/env bash
# The book answer, both halves: a line in /etc/fstab for the share that is always
# wanted, and a two-file indirect autofs map for the one that is wanted rarely.
#
# Straight-line on purpose - no loops, no conditionals, no functions. The Lab
# screen builds its rung-4 command sketch out of the leading word of each command
# in the alphabetically first solution (see src/engine/disclosure/content.ts), so a
# `for` or an `if` here would put the word "for" in front of a student instead of
# the tool they need.
set -euo pipefail

# The leftover share: unmount it, then take its line out of /etc/fstab so it does
# not come back. The pattern demands whitespace on both sides of the mount point,
# so it cannot match some other path that merely starts with the same text.
sudo umount /mnt/oldshare
sudo sed -i '\|[[:space:]]/mnt/oldshare[[:space:]]|d' /etc/fstab

# The report share, written down first and then mounted from what was written -
# which is also how you find out you got the line right.
sudo mkdir -p /mnt/reports
printf 'nfsstore.lab.example.com:/export/reports /mnt/reports nfs defaults 0 0\n' | sudo tee -a /etc/fstab >/dev/null
sudo systemctl daemon-reload
sudo mount /mnt/reports

# The archive, on demand. File one names the directory the mounts appear under and
# the map that describes them; file two names one share inside it. The key
# `archive` is relative to /nfsdata, which is what makes /nfsdata/archive the path.
printf '/nfsdata /etc/auto.nfsdata\n' | sudo tee -a /etc/auto.master >/dev/null
printf 'archive -fstype=nfs,rw nfsstore.lab.example.com:/export/archive\n' | sudo tee /etc/auto.nfsdata >/dev/null
sudo systemctl enable --now autofs

# Nothing is mounted until the path is used, so use it. This is the test, not a
# side effect: if the map is wrong, this line is where the answer falls over.
#
# One thing to expect on THIS host, which is both client and server: `findmnt
# /nfsdata/archive` afterwards will not say `nfs`. The automounter works out how
# far away the server in a map entry is, and when the answer is "it is this
# machine" it bind-mounts the exported directory rather than speaking NFS to
# itself - man 5 auto.master documents `nobind` as the option that "prevent[s]
# bind mounting of local NFS filesystems". Against a real remote server the same
# two files produce a real nfs mount. The map is not wrong; the answer is correct
# either way, and the grader accepts both.
ls -A /nfsdata/archive >/dev/null
findmnt /mnt/reports >/dev/null
