#!/usr/bin/env bash
# The mistake a filename cannot catch. The requirement gave the archive's name -
# /home/backupop/reports.tar.gz - and named the compression separately, and this
# candidate got the name right and the compression wrong. Nothing on the system
# objects: tar writes whatever you asked it to write to whatever name you gave, and
# a file called reports.tar.gz containing a bzip2 stream is a perfectly ordinary
# file that no tool will complain about until something tries to gunzip it.
#
# The reasoning is not even a mistake in isolation. bzip2 compresses tighter than
# gzip, the objective this task grades names both, and on an archive of text a
# candidate optimising for size would reasonably reach for -j. It is wrong here
# only because the requirement was explicit, and requirements about interchange
# formats usually are: the operator's restore procedure, or a cron job, or a script
# on another machine expects gzip, and "it is smaller this way" is not an
# improvement anybody asked for.
#
# The extraction is spelled -j to match, so the tree on the far side is completely
# correct: right place, right contents, right modes, right times, right owner. The
# candidate is internally consistent and still wrong.
#
# Why exactly one red line, which is the interesting part:
#
#   the format check reads the first bytes, not the name. Measured: gzip streams
#     start 1f 8b (RFC 1952 2.3.1), bzip2 starts 42 5a 68 39 ("BZh9"), and
#     `gzip -t` on this file exits 1 saying "not in gzip format". Both readings
#     agree, and neither can be fooled by the extension.
#   the contents check does NOT read the name either, and that is why it passes.
#     GNU tar identifies the payload from its magic number, so `tar -tf` lists this
#     archive without a word of complaint - measured on tar 1.34 with a bzip2
#     archive named .tar.gz. (`tar -tzf` on the same file exits 2: "gzip: stdin:
#     not in gzip format". Insisting on the compression letter is how a candidate
#     discovers this in ten seconds.) The tree really is in there; it is just
#     wrapped in the wrong thing.
#
# So the verdict says precisely what went wrong - the format, and nothing else -
# rather than reporting a broken archive that is not broken.
#
#   Wrong from the moment the archive is created, and a reboot does not recompress
#   a file: no phase.
# expect-fail: archive-is-gzip
set -euo pipefail

# -j is bzip2 where -z is gzip. One letter, and the only difference between this
# fixture and a correct answer.
tar -cjf "$HOME/reports.tar.gz" -C /srv reports

# The candidate's own check, which passes, because they used -j here too and
# therefore never learned that the name lied.
tar -tjf "$HOME/reports.tar.gz"

timeout 25 scp -i /home/student/backup-key -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$HOME/reports.tar.gz" backupop@localhost:/home/backupop/reports.tar.gz < /dev/null

# -p is here, so the modes and times all survive: this fixture must fail for one
# reason only.
timeout 25 ssh -n -i /home/student/backup-key -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null backupop@localhost 'tar -xpjf ~/reports.tar.gz' < /dev/null

# Where the answer actually is. Two commands, either of which would have caught
# this before the handover: the magic number, and gzip's own opinion of a file
# whose name promises gzip.
od -An -tx1 -N4 "$HOME/reports.tar.gz"
gzip -t "$HOME/reports.tar.gz" || true
file "$HOME/reports.tar.gz" || true
